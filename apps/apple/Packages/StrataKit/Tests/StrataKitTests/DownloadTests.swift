import XCTest
@testable import StrataKit

final class DownloadTests: XCTestCase {
    private let base = URL(string: "http://strata.test:8420")!
    private func client(token: String? = "tok") -> StrataClient {
        StrataClient(baseURL: base, token: token, session: StubProtocol.session(), cacheTTL: 0)
    }

    private static let response: [String: Any] = [
        "fileId": 7,
        "url": "/api/files/7/content",
        "mode": "device",
        "remux": ["audio": "lossless", "audioStreamIndex": 1, "videoStreamIndex": 0, "stripDolbyVision": false],
        "durationMs": 7_200_000,
        "candidate": ["id": "file:7", "fileId": 7, "provider": "local", "name": "Film.2021.1080p.mkv", "size": 4_000_000_000, "probed": true],
        "audioTracks": [["index": 1, "codec": "dts", "channels": 6, "selected": true]],
        "subtitleTracks": [["id": "s2", "codec": "subrip", "forced": false, "isDefault": false, "external": false, "url": NSNull(), "embedded": true, "streamIndex": 2]],
        "chapters": [["startMs": 0]],
    ]

    func testPrepareDownloadResolvesTheServersOwnAddress() async throws {
        StubProtocol.reset { _ in .json(200, Self.response) }
        guard case .ready(let res) = try await client().prepareDownload(.movie(42), candidateId: "file:7") else { return XCTFail("expected ready") }
        XCTAssertEqual(res.url.absoluteString, "http://strata.test:8420/api/files/7/content")
        XCTAssertEqual(res.mode, .device)
        XCTAssertEqual(res.subtitleTracks.first?.isEmbedded, true)
        let req = try XCTUnwrap(StubProtocol.recorded.first)
        XCTAssertEqual(req.url?.path, "/api/downloads")
        XCTAssertEqual(req.jsonBody?["candidateId"] as? String, "file:7")
        XCTAssertNil(req.jsonBody?["preferMaxHeight"], "a chosen source is kept")
    }

    func testPrepareDownload428AsksForTheFilesDetails() async throws {
        StubProtocol.reset { _ in .json(428, ["needsProbe": ["fileId": 7, "url": "https://cdn.torbox.test/7"]]) }
        guard case .needsProbe(let fileId, let url) = try await client().prepareDownload(.movie(42)) else { return XCTFail("expected needsProbe") }
        XCTAssertEqual(fileId, 7)
        XCTAssertEqual(url.host, "cdn.torbox.test")
    }

    func testDownloadRequestSendsTheTokenOnlyToTheServer() {
        let c = client()
        XCTAssertEqual(c.downloadRequest(URL(string: "http://strata.test:8420/api/files/7/content")!).value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertNil(c.downloadRequest(URL(string: "https://cdn.torbox.test/7")!).value(forHTTPHeaderField: "Authorization"))
    }

    func testOfflinePlayResponseResumesWhereItWasLeft() throws {
        let data = try JSONSerialization.data(withJSONObject: Self.response)
        let response = try JSONDecoder().decode(DownloadResponse.self, from: data)
        var item = DownloadItem(signInID: "me", target: .movie(42), title: "Film", subtitle: "2021", artworkURL: nil, response: response)
        XCTAssertEqual(item.id, "me:movie:42::")
        XCTAssertEqual(item.fileExtension, "mkv")
        item.positionMs = 600_000
        let file = URL(fileURLWithPath: "/tmp/film.mkv")
        let res = item.playResponse(fileURL: file, resumeMs: item.positionMs)
        XCTAssertTrue(res.isOffline)
        XCTAssertEqual(res.url, file)
        XCTAssertEqual(res.mode, .device)
        XCTAssertEqual(res.seekToMs, 600_000)
        XCTAssertEqual(res.startOffsetMs, 0)
        XCTAssertEqual(item.playResponse(fileURL: file, resumeMs: 7_195_000).seekToMs, 0, "near the end starts over")
    }

    func testProgressQueueKeepsTheLatestAndSendsItOnceOnline() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("queue-\(UUID().uuidString).json")
        let queue = ProgressQueue(url: url)
        await queue.enqueue(signInID: "me", target: .movie(42), positionMs: 1000, durationMs: 9000)
        await queue.enqueue(signInID: "me", target: .movie(42), positionMs: 5000, durationMs: 9000)
        await queue.enqueue(signInID: "other", target: .movie(42), positionMs: 7000, durationMs: 9000)

        StubProtocol.reset { _ in throw URLError(.notConnectedToInternet) }
        await queue.flush(client: client(), signInID: "me")
        let reopened = ProgressQueue(url: url)
        let stillQueued = await reopened.isEmpty
        XCTAssertFalse(stillQueued, "kept on disk while offline")

        StubProtocol.reset { _ in .json(200, ["positionMs": 5000, "durationMs": 9000, "completed": false]) }
        await reopened.flush(client: client(), signInID: "me")
        let sent = StubProtocol.recorded.filter { $0.url?.path == "/api/progress" }
        XCTAssertEqual(sent.count, 1, "only the latest position for the title")
        XCTAssertEqual(sent.first?.jsonBody?["positionMs"] as? Int, 5000)
        let empty = await reopened.isEmpty
        XCTAssertFalse(empty, "the other profile's position waits for it")
    }
}
