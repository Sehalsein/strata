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

    func testCandidatesTryHTTPSFirstForABareDomain() {
        let cases: [(String, [String])] = [
            ("strata-demo.example.workers.dev", ["https://strata-demo.example.workers.dev", "http://strata-demo.example.workers.dev:8420"]),
            ("192.168.1.20", ["http://192.168.1.20:8420"]),
            ("nas.local", ["http://nas.local:8420"]),
            ("nas", ["http://nas:8420"]),
            ("box.example.com:9000", ["http://box.example.com:9000"]),
            ("http://box.example.com", ["http://box.example.com:8420"]),
            ("https://box.example.com", ["https://box.example.com"]),
            ("[fd7a:115c::1]", ["http://[fd7a:115c::1]:8420"]),
            ("not a host", []),
        ]
        for (input, expected) in cases {
            XCTAssertEqual(ServerAddress.candidates(input).map(\.absoluteString), expected, "input: \(input)")
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
        let outcome = try await client().play(.episode(show: .tmdb(.show, 9001), season: 1, episode: 2), candidateId: "file:3", startMs: 12_000, audioStreamIndex: 2)
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
        _ = try await client().play(.movie(.tmdb(.movie, 10378)))
        let body = try XCTUnwrap(StubProtocol.recorded.first?.jsonBody)
        XCTAssertNil(body["season"])
        XCTAssertNil(body["startMs"], "nil startMs lets the server resume from saved progress")
        XCTAssertNil(body["candidateId"])
    }

    func testPlay202IsPreparing() async throws {
        StubProtocol.reset { _ in .fixture("preparing", status: 202) }
        let outcome = try await client().play(.movie(.tmdb(.movie, 10378)), candidateId: "hash:abc")
        guard case .preparing(let status) = outcome else { return XCTFail("expected preparing") }
        XCTAssertEqual(status.title, "Getting it ready")
        XCTAssertEqual(status.progress, 0.37, accuracy: 0.0001)
        XCTAssertEqual(status.etaText, "14m left")
    }

    func testPlay428AsksForTheFilesMediaInfo() async throws {
        StubProtocol.reset { _ in .fixture("needs_probe", status: 428) }
        let outcome = try await client().play(.movie(.tmdb(.movie, 10378)))
        XCTAssertEqual(outcome, .needsProbe(fileId: 42, url: URL(string: "https://store-031.weur.tb-cdn.st/dld/4a1b6c?token=abc&file=Big.Buck.Bunny.2008.2160p.mkv")!))
    }

    func testPlayOtherErrorsStillThrow() async throws {
        StubProtocol.reset { _ in .fixture("error_404", status: 404) }
        do {
            _ = try await client().play(.movie(.tmdb(.movie, 1)))
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.status, 404)
            XCTAssertEqual(e.message, "That title isn't in the catalog.")
        }
    }

    func testReportProbePostsTheMediaInfo() async throws {
        struct Info: Encodable, Sendable { var container = "mkv"; var durationMs = 1000 }
        StubProtocol.reset { _ in StubProtocol.Reply(status: 200, body: Data(#"{"ok":true}"#.utf8)) }
        try await client().reportProbe(fileId: 42, info: Info())
        let req = try XCTUnwrap(StubProtocol.recorded.first)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.url?.path, "/api/files/42/probe")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(req.jsonBody)
        XCTAssertEqual(body["container"] as? String, "mkv")
        XCTAssertEqual(body["durationMs"] as? Int, 1000)
    }

    func testErrorShapeSurfacesServerMessage() async throws {
        StubProtocol.reset { _ in .fixture("error_404", status: 404) }
        do {
            _ = try await client().movie(.tmdb(.movie, 1))
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .http)
            XCTAssertEqual(e.status, 404)
            XCTAssertEqual(e.message, "That title isn't in the catalog.")
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

    func testHouseholdRequired409() async throws {
        StubProtocol.reset { _ in .json(409, ["error": "Choose a household first"]) }
        do {
            _ = try await client().home()
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertTrue(e.needsHousehold)
        }
    }

    func testSignInByUsernameOrEmailUsesTheHeaderToken() async throws {
        StubProtocol.reset { _ in
            StubProtocol.Reply(status: 200, body: try! Fixture.data("sign_in"),
                               headers: ["Content-Type": "application/json", "set-auth-token": "signed.token"])
        }
        let anon = client(token: nil)
        let token = try await anon.signIn(login: " owner ", password: "pw")
        XCTAssertEqual(token, "signed.token")
        _ = try await anon.signIn(login: "ann@example.com", password: "pw")
        let reqs = StubProtocol.recorded
        XCTAssertEqual(reqs.map(\.url!.path), ["/api/auth/sign-in/username", "/api/auth/sign-in/email"])
        XCTAssertEqual(reqs[0].jsonBody?["username"] as? String, "owner")
        XCTAssertEqual(reqs[1].jsonBody?["email"] as? String, "ann@example.com")
        XCTAssertNil(reqs[0].value(forHTTPHeaderField: "Authorization"))

        // Without the header, the body's token.
        StubProtocol.reset { _ in .fixture("sign_in") }
        let fromBody = try await anon.signIn(login: "owner", password: "pw")
        XCTAssertEqual(fromBody, "ckKMkx9x4y1bMdUJgg0hvdQ3Ki05Z6CF")
    }

    func testBetterAuthErrorsAreReadable() async throws {
        StubProtocol.reset { _ in .fixture("error_sign_in", status: 401) }
        do {
            _ = try await client(token: nil).signIn(login: "owner", password: "nope")
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.status, 401)
            XCTAssertEqual(e.message, "Invalid username or password")
            XCTAssertEqual(e.code, "INVALID_USERNAME_OR_PASSWORD")
        }
        StubProtocol.reset { _ in .json(429, ["message": "Too many requests. Please try again later."]) }
        do {
            _ = try await client(token: nil).signIn(login: "owner", password: "nope")
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertTrue(e.isRateLimited)
            XCTAssertEqual(e.message, "Too many requests. Please try again later.")
        }
        StubProtocol.reset { _ in .fixture("error_device", status: 400) }
        do {
            _ = try await client(token: nil).pollDeviceCode("nope")
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.code, "invalid_grant")
            XCTAssertEqual(e.message, "Invalid device code")
        }
    }

    func testDeviceCodeFlow() async throws {
        var answers: [StubProtocol.Reply] = [
            .json(400, ["error": "authorization_pending", "error_description": "Authorization pending"]),
            .json(400, ["error": "slow_down", "error_description": "Polling too frequently"]),
            .json(400, ["error": "access_denied", "error_description": "Access denied"]),
            .json(400, ["error": "expired_token", "error_description": "Expired"]),
            .json(200, ["access_token": "tv-token", "token_type": "Bearer", "expires_in": 100, "scope": ""]),
        ]
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/auth/device/code": return .fixture("device_code")
            case "/api/auth/device/token": return answers.removeFirst()
            case "/api/auth/device": return .fixture("device_status")
            default: return .json(200, ["success": true])
            }
        }
        let tv = client(token: nil)
        let code = try await tv.startDeviceCode()
        var polls: [DeviceTokenPoll] = []
        for _ in 0..<5 { polls.append(try await tv.pollDeviceCode(code.deviceCode)) }
        XCTAssertEqual(polls, [.pending, .slowDown, .denied, .expired, .approved(token: "tv-token")])

        let phone = client(token: "phone")
        let status = try await phone.deviceCodeStatus(userCode: "k9y9-33ub")
        XCTAssertTrue(status.isPending)
        try await phone.approveDevice(userCode: "k9y9-33ub")
        try await phone.denyDevice(userCode: "K9Y933UB")

        let reqs = StubProtocol.recorded
        XCTAssertEqual(reqs[0].jsonBody?["client_id"] as? String, "strata-apple-tv")
        XCTAssertEqual(reqs[1].jsonBody?["grant_type"] as? String, "urn:ietf:params:oauth:grant-type:device_code")
        XCTAssertEqual(reqs[1].jsonBody?["device_code"] as? String, code.deviceCode)
        XCTAssertEqual(reqs[1].jsonBody?["client_id"] as? String, "strata-apple-tv")
        XCTAssertEqual(reqs[6].url?.query, "user_code=K9Y933UB")
        XCTAssertEqual(reqs[6].value(forHTTPHeaderField: "Authorization"), "Bearer phone")
        XCTAssertEqual(reqs[7].url?.path, "/api/auth/device/approve")
        XCTAssertEqual(reqs[7].jsonBody?["userCode"] as? String, "K9Y933UB")
        XCTAssertEqual(reqs[8].url?.path, "/api/auth/device/deny")
    }

    func testHouseholdsJoinAndPassword() async throws {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/auth/organization/list": return .fixture("households")
            case "/api/join": return req.jsonBody?["userId"] == nil ? .fixture("join_choices") : .json(200, ["token": "joined"])
            case "/api/auth/change-password":
                return StubProtocol.Reply(status: 200, body: Data(#"{"token":"new-raw","user":{}}"#.utf8),
                                          headers: ["Content-Type": "application/json", "set-auth-token": "new-signed"])
            default: return .json(200, ["id": "h2", "name": "Cabin"])
            }
        }
        let c = client()
        let households = try await c.households()
        XCTAssertEqual(households.count, 1)
        try await c.setActiveHousehold("h2")
        let choices = try await client(token: nil).homeJoinChoices()
        XCTAssertEqual(choices.members.count, 1)
        let joined = try await client(token: nil).join(userId: "u1")
        XCTAssertEqual(joined, "joined")
        let newToken = try await c.changePassword(current: "old-pass", new: "new-pass-1")
        XCTAssertEqual(newToken, "new-signed")
        try await c.signOut()

        let reqs = StubProtocol.recorded
        XCTAssertEqual(reqs.map { "\($0.httpMethod!) \($0.url!.path)" }, [
            "GET /api/auth/organization/list", "POST /api/auth/organization/set-active", "POST /api/join", "POST /api/join",
            "POST /api/auth/change-password", "POST /api/auth/sign-out",
        ])
        XCTAssertEqual(reqs[1].jsonBody?["organizationId"] as? String, "h2")
        XCTAssertEqual(reqs[3].jsonBody?["userId"] as? String, "u1")
        XCTAssertEqual(reqs[4].jsonBody?["currentPassword"] as? String, "old-pass")
        XCTAssertEqual(reqs[4].jsonBody?["newPassword"] as? String, "new-pass-1")
        XCTAssertEqual(reqs[4].jsonBody?["revokeOtherSessions"] as? Bool, true)
        // Better Auth's POSTs take JSON even when there's nothing to send.
        XCTAssertEqual(reqs[5].value(forHTTPHeaderField: "Content-Type"), "application/json")
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
        let items = try await client().sources(.episode(show: .tmdb(.show, 9001), season: 2, episode: 3), discover: true)
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
        let p = try await c.reportProgress(.movie(.tmdb(.movie, 10378)), positionMs: 13_000, durationMs: 30_000, sessionId: "abc")
        XCTAssertTrue(p.completed)
        try await c.setWatched(.episode(show: .tmdb(.show, 1), season: 1, episode: 1), true)
        try await c.setWatchlist(.tmdb(.show, 9001), true)
        try await c.stopPlayback(sessionId: "abc")
        let reqs = StubProtocol.recorded
        XCTAssertEqual(reqs.map { "\($0.httpMethod!) \($0.url!.path)" }, [
            "POST /api/progress", "POST /api/watched", "PUT /api/watchlist", "DELETE /api/play/abc",
        ])
        XCTAssertEqual(reqs[0].jsonBody?["sessionId"] as? String, "abc")
        XCTAssertEqual(reqs[1].jsonBody?["watched"] as? Bool, true)
        XCTAssertEqual(reqs[2].jsonBody?["type"] as? String, "show")
        XCTAssertEqual(reqs[2].jsonBody?["on"] as? Bool, true)
        for r in reqs.prefix(3) { XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/json") }
    }

    func testCacheAndClear() async throws {
        StubProtocol.reset { _ in .fixture("home") }
        let c = client(ttl: 60)
        _ = try await c.homeCatalog()
        _ = try await c.homeCatalog()
        XCTAssertEqual(StubProtocol.recorded.count, 1)
        XCTAssertEqual(StubProtocol.recorded[0].cachePolicy, .reloadIgnoringLocalCacheData)
        await c.clearCache()
        _ = try await c.homeCatalog()
        XCTAssertEqual(StubProtocol.recorded.count, 2)
        // The profile's rails are never kept.
        _ = try await c.homeProfile()
        _ = try await c.homeProfile()
        XCTAssertEqual(StubProtocol.recorded.count, 4)
        // Mutations drop what they change, and nothing else.
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/watchlist": .json(200, ["ok": true])
            case "/api/calendar": .json(200, ["items": []])
            default: .fixture("home")
            }
        }
        _ = try await c.calendar()
        try await c.setWatchlist(.tmdb(.movie, 1), false)
        _ = try await c.homeCatalog()
        _ = try await c.calendar()
        XCTAssertEqual(StubProtocol.recorded.map(\.url!.path), ["/api/calendar", "/api/watchlist", "/api/calendar"])
    }

    func testHomeFromAServerWithoutParts() async throws {
        StubProtocol.reset { req in req.url?.path == "/api/home" ? .fixture("home") : .json(404, ["error": "Not found"]) }
        let c = client(ttl: 60)
        let catalog = try await c.homeCatalog()
        let mine = try await c.homeProfile()
        XCTAssertFalse(catalog.isEmpty)
        XCTAssertTrue(mine.isEmpty)
    }

    func testServerMaxAgeAndStaleWhileRevalidate() async throws {
        var maxAge = "0"
        StubProtocol.reset { _ in
            var reply = StubProtocol.Reply.fixture("home")
            reply.headers["Cache-Control"] = "private, max-age=\(maxAge), stale-while-revalidate=604800"
            return reply
        }
        let c = client(ttl: 60)
        // Nothing kept yet.
        do { _ = try await c.homeCatalog(.cachedOnly); XCTFail("expected notCached") } catch let e as StrataError { XCTAssertEqual(e.kind, .notCached) }
        XCTAssertEqual(StubProtocol.recorded.count, 0)
        // max-age=0 overrides the client's 60s: kept, but stale at once.
        _ = try await c.homeCatalog()
        _ = try await c.homeCatalog(.cachedOnly)
        _ = try await c.homeCatalog()
        XCTAssertEqual(StubProtocol.recorded.count, 2)
        // A day's max-age: fresh until a reload asks anyway.
        maxAge = "86400"
        _ = try await c.homeCatalog(.reload)
        _ = try await c.homeCatalog()
        XCTAssertEqual(StubProtocol.recorded.count, 3)
        _ = try await c.homeCatalog(.reload)
        XCTAssertEqual(StubProtocol.recorded.count, 4)
    }

    func testPersistentCacheSurvivesANewClientAndTitlesDropTheirSeasons() async throws {
        StubProtocol.reset { req in
            if req.url?.path == "/api/progress" { return .json(200, ["positionMs": 1, "durationMs": 2, "completed": false]) }
            var reply = StubProtocol.Reply.fixture(req.url!.path.contains("seasons") ? "season" : "show")
            reply.headers["Cache-Control"] = "private, max-age=86400"
            return reply
        }
        let token = "disk-\(UUID().uuidString)"
        func make() -> StrataClient { StrataClient(baseURL: base, token: token, session: StubProtocol.session(), persistent: true) }
        let first = make()
        defer { Task { await first.clearCache() } }
        _ = try await first.show(.tmdb(.show, 9001))
        _ = try await first.season(show: .tmdb(.show, 9001), 1)
        _ = try await make().show(.tmdb(.show, 9001))
        _ = try await make().season(show: .tmdb(.show, 9001), 1)
        XCTAssertEqual(StubProtocol.recorded.count, 2)

        try await first.reportProgress(.episode(show: .tmdb(.show, 9001), season: 1, episode: 2), positionMs: 1, durationMs: 2)
        _ = try await make().show(.tmdb(.show, 9001))
        _ = try await make().season(show: .tmdb(.show, 9001), 1)
        XCTAssertEqual(StubProtocol.recorded.map(\.url!.path).suffix(3), ["/api/progress", "/api/titles/tmdb:show:9001", "/api/titles/tmdb:show:9001/seasons/1"])
    }

    func testAnswerTheServerTurnsDownIsNoLongerKept() async throws {
        var denied = false
        StubProtocol.reset { req in
            if denied { return .json(403, ["error": "Not allowed for this profile"]) }
            var reply = StubProtocol.Reply.fixture("show")
            reply.headers["Cache-Control"] = "private, max-age=0"
            return reply
        }
        let token = "deny-\(UUID().uuidString)"
        let c = StrataClient(baseURL: base, token: token, session: StubProtocol.session(), persistent: true)
        _ = try await c.show(.tmdb(.show, 9001))
        _ = try await c.show(.tmdb(.show, 9001), .cachedOnly)
        denied = true
        do { _ = try await c.show(.tmdb(.show, 9001)); XCTFail("expected 403") } catch let e as StrataError { XCTAssertEqual(e.status, 403) }
        // Gone from memory and disk: a new client (a cold launch) has nothing to show either.
        for client in [c, StrataClient(baseURL: base, token: token, session: StubProtocol.session(), persistent: true)] {
            do { _ = try await client.show(.tmdb(.show, 9001), .cachedOnly); XCTFail("expected notCached") } catch let e as StrataError { XCTAssertEqual(e.kind, .notCached) }
        }

        denied = false
        _ = try await c.show(.tmdb(.show, 9001))
        StrataClient.purgeCache(token: token)
        let fresh = StrataClient(baseURL: base, token: token, session: StubProtocol.session(), persistent: true)
        do { _ = try await fresh.show(.tmdb(.show, 9001), .cachedOnly); XCTFail("expected notCached") } catch let e as StrataError { XCTAssertEqual(e.kind, .notCached) }
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

final class SameOriginTests: XCTestCase {
    func testCredentialsOnlyForTheServer() {
        let client = StrataClient(baseURL: URL(string: "http://192.168.1.20:8420")!, token: "t")
        XCTAssertTrue(client.isSameOrigin(URL(string: "http://192.168.1.20:8420/api/stream/x/subtitles/s3.vtt")!))
        XCTAssertFalse(client.isSameOrigin(URL(string: "http://evil.example:8420/sub.vtt")!))
        XCTAssertFalse(client.isSameOrigin(URL(string: "https://192.168.1.20:8420/sub.vtt")!))
        XCTAssertFalse(client.isSameOrigin(URL(string: "http://192.168.1.20:9000/sub.vtt")!))
        let https = StrataClient(baseURL: URL(string: "https://strata.example.com")!, token: "t")
        XCTAssertTrue(https.isSameOrigin(URL(string: "https://strata.example.com:443/a")!))
    }
}
