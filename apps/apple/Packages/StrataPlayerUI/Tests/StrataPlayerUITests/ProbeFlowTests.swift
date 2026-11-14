import Foundation
import XCTest
import StrataKit
@testable import StrataPlayerUI

/// When the server has no media info for a file it answers /api/play with 428: the engine
/// reads the file's header itself, sends it, and asks to play again.
@MainActor
final class ProbeFlowTests: XCTestCase {
    /// A file StrataRemux's tests use (HEVC, E-AC-3, SRT), read through a `file:` link.
    private let media = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().appendingPathComponent("StrataRemux/Tests/StrataRemuxTests/Fixtures/hevc_eac3_srt.mkv")

    private func engine() -> PlayerEngine {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ServerStub.self]
        let engine = PlayerEngine()
        engine.configure(client: StrataClient(baseURL: URL(string: "http://strata.test:8420")!, token: "tok",
                                              session: URLSession(configuration: config), cacheTTL: 0))
        return engine
    }

    private func json(_ object: Any) -> Data { try! JSONSerialization.data(withJSONObject: object) }

    func testReadsTheFileReportsItAndAsksAgain() async throws {
        let needsProbe = json(["needsProbe": ["fileId": 42, "url": media.absoluteString]])
        ServerStub.reset { req, n in
            switch (req.url!.path, n) {
            case ("/api/play", 0): (428, needsProbe)
            case ("/api/files/42/probe", _): (200, Data(#"{"ok":true}"#.utf8))
            // Ends the test's load once the second play request has been seen.
            default: (404, Data(#"{"error":"stop here"}"#.utf8))
            }
        }
        let engine = engine()
        await engine.load(target: .movie(.tmdb(.movie, 10378)), meta: PlaybackMeta(title: "t"), startMs: 5000)

        let requests = ServerStub.recorded
        XCTAssertEqual(requests.map { $0.url!.path }, ["/api/play", "/api/files/42/probe", "/api/play"])
        let report = try XCTUnwrap(requests[1].jsonBody)
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(report["container"] as? String, "mkv")
        XCTAssertEqual(report["durationMs"] as? Int, 20_000)
        XCTAssertEqual((report["video"] as? [String: Any])?["codec"] as? String, "hevc")
        XCTAssertTrue((report["video"] as? [String: Any])?["hdr"] is NSNull)
        XCTAssertEqual((report["audio"] as? [[String: Any]])?.first?["codec"] as? String, "eac3")
        XCTAssertEqual((report["subtitles"] as? [[String: Any]])?.first?["isText"] as? Bool, true)

        let retry = try XCTUnwrap(requests[2].jsonBody)
        XCTAssertEqual(retry["candidateId"] as? String, "file:42", "the same file the server chose")
        XCTAssertEqual(retry["startMs"] as? Int, 5000)
        XCTAssertEqual(engine.status, .failed("stop here"))
    }

    func testKeepsTheCandidateItWasAskedFor() async throws {
        let needsProbe = json(["needsProbe": ["fileId": 7, "url": media.absoluteString]])
        ServerStub.reset { req, n in
            switch (req.url!.path, n) {
            case ("/api/play", 0): (428, needsProbe)
            case ("/api/files/7/probe", _): (200, Data(#"{"ok":true}"#.utf8))
            default: (404, Data(#"{"error":"stop here"}"#.utf8))
            }
        }
        await engine().load(target: .movie(.tmdb(.movie, 10378)), meta: PlaybackMeta(title: "t"), candidateId: "hash:abc")
        XCTAssertEqual(ServerStub.recorded.last?.jsonBody?["candidateId"] as? String, "hash:abc")
    }

    func testAFileThatCantBeReadFailsWithAMessage() async throws {
        let missing = URL(fileURLWithPath: "/nonexistent/\(UUID().uuidString).mkv")
        let needsProbe = json(["needsProbe": ["fileId": 42, "url": missing.absoluteString]])
        ServerStub.reset { _, _ in (428, needsProbe) }
        let engine = engine()
        await engine.load(target: .movie(.tmdb(.movie, 10378)), meta: PlaybackMeta(title: "t"))
        guard case .failed(let message) = engine.status else { return XCTFail("\(engine.status)") }
        XCTAssertTrue(message.hasPrefix("This file couldn't be read ("), message)
        XCTAssertTrue(message.hasSuffix("). Pick another source."), message)
        // Nothing reported; the player then asks for other copies to fall back to (none here).
        XCTAssertEqual(ServerStub.recorded.map { $0.url!.path }, ["/api/play", "/api/sources"], "nothing reported")
    }

    func testProbesAFileOnlyOncePerLoad() async throws {
        let needsProbe = json(["needsProbe": ["fileId": 42, "url": media.absoluteString]])
        ServerStub.reset { req, _ in
            req.url!.path == "/api/play" ? (428, needsProbe) : (200, Data(#"{"ok":true}"#.utf8))
        }
        let engine = engine()
        await engine.load(target: .movie(.tmdb(.movie, 10378)), meta: PlaybackMeta(title: "t"))
        // Probed once; then the player asks for other copies to fall back to (none here).
        XCTAssertEqual(ServerStub.recorded.map { $0.url!.path }, ["/api/play", "/api/files/42/probe", "/api/play", "/api/sources"])
        guard case .failed = engine.status else { return XCTFail("\(engine.status)") }
    }
}

/// Answers the client's requests: `handler` gets the request and how many times its path
/// was asked for before.
final class ServerStub: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest, Int) -> (Int, Data)
    nonisolated(unsafe) private static var handler: Handler?
    nonisolated(unsafe) private static var requests: [URLRequest] = []
    private static let lock = NSLock()

    static func reset(_ handler: @escaping Handler) {
        lock.lock(); defer { lock.unlock() }
        self.handler = handler
        requests = []
    }

    static var recorded: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        var req = request
        // URLSession moves bodies into a stream; read it back so tests can inspect it.
        if req.httpBody == nil, let stream = req.httpBodyStream {
            stream.open()
            var data = Data()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                data.append(buf, count: n)
            }
            stream.close()
            req.httpBody = data
        }
        Self.lock.lock()
        let seen = Self.requests.filter { $0.url?.path == req.url?.path }.count
        Self.requests.append(req)
        let handler = Self.handler
        Self.lock.unlock()
        let (status, body) = handler?(req, seen) ?? (500, Data())
        let response = HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
}

private extension URLRequest {
    var jsonBody: [String: Any]? {
        httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
}
