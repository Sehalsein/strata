import XCTest
@testable import StrataKit

final class ServerAddressTests: XCTestCase {
    func testNormalize() {
        let cases: [(String, String?)] = [
            ("192.168.1.20", "http://192.168.1.20:8420"),
            ("  nas.local  ", "http://nas.local:8420"),
            ("NAS.Local:9000", "http://nas.local:9000"),
            ("http://10.0.0.5", "http://10.0.0.5:8420"),
            ("http://10.0.0.5:8420/", "http://10.0.0.5:8420"),
            ("http://10.0.0.5:8420/web/index.html?x=1#y", "http://10.0.0.5:8420"),
            ("https://strata.example.com", "https://strata.example.com"),
            ("https://strata.example.com:8443/", "https://strata.example.com:8443"),
            ("HTTP://Box.ts.net", "http://box.ts.net:8420"),
            ("[fd7a:115c::1]", "http://[fd7a:115c::1]:8420"),
            ("[fd7a:115c::1]:9000", "http://[fd7a:115c::1]:9000"),
            ("", nil),
            ("   ", nil),
            ("ftp://example.com", nil),
            ("not a host", nil),
        ]
        for (input, expected) in cases {
            XCTAssertEqual(ServerAddress.normalize(input)?.absoluteString, expected, "input: \(input)")
        }
    }

    func testResolveRelative() {
        let base = URL(string: "http://192.168.1.20:8420")!
        XCTAssertEqual(ServerAddress.resolve(URL(string: "/api/stream/abc/stream.m3u8")!, against: base).absoluteString,
                       "http://192.168.1.20:8420/api/stream/abc/stream.m3u8")
        let absolute = URL(string: "https://cdn.example.com/x.mp4")!
        XCTAssertEqual(ServerAddress.resolve(absolute, against: base), absolute)
        XCTAssertEqual(ServerAddress.display(base), "192.168.1.20:8420")
    }
}

final class ClientTests: XCTestCase {
    private let base = URL(string: "http://strata.test:8420")!
    private func client(token: String? = "tok", ttl: TimeInterval = 0) -> StrataClient {
        StrataClient(baseURL: base, token: token, session: StubProtocol.session(), cacheTTL: ttl)
    }

    func testPlayStartedResolvesURLsAndSendsBody() async throws {
        StubProtocol.reset { _ in .fixture("play_remux") }
        let outcome = try await client().play(.episode(show: 9001, season: 1, episode: 2), candidateId: "file:3", startMs: 12_000, audioStreamIndex: 2)
        guard case .started(let res) = outcome else { return XCTFail("expected started") }
        XCTAssertEqual(res.url.absoluteString, "http://strata.test:8420/api/stream/a83f4d9d1b7e1f6bf8b6b7a81fd81607/stream.m3u8")
        XCTAssertEqual(res.subtitleTracks[0].url?.absoluteString, "http://strata.test:8420/api/stream/a83f4d9d1b7e1f6bf8b6b7a81fd81607/subtitles/s2.vtt")

        let req = try XCTUnwrap(StubProtocol.recorded.first)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.url?.path, "/api/play")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        let body = try XCTUnwrap(req.jsonBody)
        XCTAssertEqual(body["mediaType"] as? String, "episode")
        XCTAssertEqual(body["tmdbId"] as? Int, 9001)
        XCTAssertEqual(body["season"] as? Int, 1)
        XCTAssertEqual(body["episode"] as? Int, 2)
        XCTAssertEqual(body["candidateId"] as? String, "file:3")
        XCTAssertEqual(body["startMs"] as? Int, 12_000)
        XCTAssertEqual(body["audioStreamIndex"] as? Int, 2)
        let caps = try XCTUnwrap(body["caps"] as? [String: Any])
        XCTAssertEqual(caps["containers"] as? [String], ["mp4", "mov", "m4v"])
        XCTAssertTrue((caps["videoCodecs"] as? [String])?.contains("hevc") == true)
        XCTAssertNotNil(caps["maxHeight"] as? Int)
    }

    func testPlayMovieOmitsEpisodeFields() async throws {
        StubProtocol.reset { _ in .fixture("play_direct") }
        _ = try await client().play(.movie(10378))
        let body = try XCTUnwrap(StubProtocol.recorded.first?.jsonBody)
        XCTAssertNil(body["season"])
        XCTAssertNil(body["startMs"], "nil startMs lets the server resume from saved progress")
        XCTAssertNil(body["candidateId"])
    }

    func testPlay202IsDownloading() async throws {
        StubProtocol.reset { _ in .fixture("downloading", status: 202) }
        let outcome = try await client().play(.movie(10378), candidateId: "hash:abc")
        guard case .downloading(let status) = outcome else { return XCTFail("expected downloading") }
        XCTAssertEqual(status.progress, 0.37, accuracy: 0.0001)
        XCTAssertEqual(status.etaSeconds, 840)
    }

    func testErrorShapeSurfacesServerMessage() async throws {
        StubProtocol.reset { _ in .fixture("error_404", status: 404) }
        do {
            _ = try await client().movie(1)
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .http)
            XCTAssertEqual(e.status, 404)
            XCTAssertEqual(e.message, "TMDB /movie/1 failed: 404")
            XCTAssertTrue(e.isNotFound)
        }
    }

    func testErrorWithoutBodyGetsFriendlyMessage() async throws {
        StubProtocol.reset { _ in StubProtocol.Reply(status: 502, body: Data("<html>bad gateway</html>".utf8)) }
        do {
            _ = try await client().home()
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.status, 502)
            XCTAssertEqual(e.message, "The server ran into a problem (502).")
        }
    }

    func testNetworkErrorIsFriendly() async throws {
        StubProtocol.reset { _ in throw URLError(.cannotConnectToHost) }
        do {
            _ = try await client().info()
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .network)
            XCTAssertTrue(e.isConnectivity)
            XCTAssertNil(e.status)
            XCTAssertTrue(e.message.contains("strata.test:8420"), e.message)
        }
    }

    func testProfileRequired409() async throws {
        StubProtocol.reset { _ in .json(409, ["error": "Select a profile first"]) }
        do {
            _ = try await client().home()
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertTrue(e.needsProfile)
        }
    }

    func testDecodingErrorIsReadable() async throws {
        StubProtocol.reset { _ in .json(200, ["unexpected": true]) }
        do {
            _ = try await client().info()
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .decoding)
        }
    }

    func testGetHasNoContentTypeAndQueryIsEncoded() async throws {
        StubProtocol.reset { _ in .fixture("search") }
        _ = try await client().search("c++ & friends")
        let req = try XCTUnwrap(StubProtocol.recorded.first)
        XCTAssertNil(req.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertEqual(req.url?.query, "q=c%2B%2B%20%26%20friends")
    }

    func testSourcesQuery() async throws {
        StubProtocol.reset { _ in .fixture("sources_discovered") }
        let items = try await client().sources(.episode(show: 9001, season: 2, episode: 3), discover: true)
        XCTAssertEqual(items.count, 3)
        let q = try XCTUnwrap(StubProtocol.recorded.first?.url?.query)
        XCTAssertEqual(q, "mediaType=episode&tmdbId=9001&season=2&episode=3&discover=1")
    }

    func testMutationsSendJSON() async throws {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/progress": return .fixture("progress")
            default: return .json(200, ["ok": true])
            }
        }
        let c = client()
        let p = try await c.reportProgress(.movie(10378), positionMs: 13_000, durationMs: 30_000, sessionId: "abc")
        XCTAssertTrue(p.completed)
        try await c.setWatched(.episode(show: 1, season: 1, episode: 1), true)
        try await c.setWatchlist(.show, tmdbId: 9001, true)
        try await c.selectProfile(id: 2, pin: "1234")
        try await c.stopPlayback(sessionId: "abc")
        try await c.logout()
        let reqs = StubProtocol.recorded
        XCTAssertEqual(reqs.map { "\($0.httpMethod!) \($0.url!.path)" }, [
            "POST /api/progress", "POST /api/watched", "PUT /api/watchlist", "POST /api/profiles/2/select", "DELETE /api/play/abc", "POST /api/auth/logout",
        ])
        XCTAssertEqual(reqs[0].jsonBody?["sessionId"] as? String, "abc")
        XCTAssertEqual(reqs[1].jsonBody?["watched"] as? Bool, true)
        XCTAssertEqual(reqs[2].jsonBody?["type"] as? String, "show")
        XCTAssertEqual(reqs[2].jsonBody?["on"] as? Bool, true)
        XCTAssertEqual(reqs[3].jsonBody?["pin"] as? String, "1234")
        for r in reqs.prefix(4) { XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/json") }
    }

    func testCacheAndClear() async throws {
        StubProtocol.reset { _ in .fixture("home") }
        let c = client(ttl: 60)
        _ = try await c.home()
        _ = try await c.home()
        XCTAssertEqual(StubProtocol.recorded.count, 1)
        await c.clearCache()
        _ = try await c.home()
        XCTAssertEqual(StubProtocol.recorded.count, 2)
        // Mutations invalidate.
        StubProtocol.reset { req in req.url?.path == "/api/watchlist" ? .json(200, ["ok": true]) : .fixture("home") }
        try await c.setWatchlist(.movie, tmdbId: 1, false)
        _ = try await c.home()
        XCTAssertEqual(StubProtocol.recorded.map(\.url!.path), ["/api/watchlist", "/api/home"])
    }

    func testSubtitlesRetryOn202() async throws {
        var calls = 0
        StubProtocol.reset { _ in
            calls += 1
            if calls == 1 {
                return StubProtocol.Reply(status: 202, body: Data(#"{"status":"extracting"}"#.utf8), headers: ["Retry-After": "0"])
            }
            return StubProtocol.Reply(status: 200, body: Data("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello from Strata\n".utf8), headers: ["Content-Type": "text/vtt"])
        }
        let text = try await client().subtitles(URL(string: "/api/stream/s/subtitles/s2.vtt")!)
        XCTAssertTrue(text.contains("Hello from Strata"))
        XCTAssertEqual(StubProtocol.recorded.count, 2)
        XCTAssertEqual(StubProtocol.recorded.first?.url?.absoluteString, "http://strata.test:8420/api/stream/s/subtitles/s2.vtt")
    }
}
