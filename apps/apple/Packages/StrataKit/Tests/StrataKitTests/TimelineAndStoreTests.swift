import XCTest
@testable import StrataKit

final class MediaTimelineTests: XCTestCase {
    func testDirectPlayIsIdentity() throws {
        let p = try Fixture.decode(PlayResponse.self, "play_direct")
        let t = MediaTimeline(p)
        XCTAssertFalse(t.isHLS)
        XCTAssertEqual(t.mediaTime(streamTime: 7), 7)
        XCTAssertEqual(MediaTimeline.initialSeek(p), 5)
        // Direct play can always seek in place, whatever the (unknown) seekable ranges.
        XCTAssertEqual(t.plan(seekTo: 25, seekable: []), .inPlace(stream: 25))
        XCTAssertEqual(t.plan(seekTo: 99, seekable: []), .inPlace(stream: 30), "clamped to duration")
    }

    func testHLSOffsetMaths() throws {
        let p = try Fixture.decode(PlayResponse.self, "play_transcode") // offset 1800 s, duration 5960 s
        let t = MediaTimeline(p)
        XCTAssertTrue(t.isHLS)
        XCTAssertNil(MediaTimeline.initialSeek(p))
        XCTAssertEqual(t.mediaTime(streamTime: 0), 1800)
        XCTAssertEqual(t.mediaTime(streamTime: 42.5), 1842.5)
        XCTAssertEqual(t.mediaTime(streamTime: .nan), 1800)
        XCTAssertEqual(t.mediaTime(streamTime: 10_000), 5960, "clamped to the server's duration")
        XCTAssertEqual(t.streamTime(mediaTime: 1900), 100)
        XCTAssertEqual(t.streamTime(mediaTime: 10), 0)
        XCTAssertEqual(t.ms(1842.5), 1_842_500)
    }

    func testHLSSeekPlan() {
        let t = MediaTimeline(startOffset: 1800, duration: 5960, isHLS: true)
        let encoded = [0.0...120.0] // 2 minutes encoded so far
        XCTAssertEqual(t.plan(seekTo: 1860, seekable: encoded), .inPlace(stream: 60))
        XCTAssertEqual(t.plan(seekTo: 1921, seekable: encoded), .inPlace(stream: 120), "within tolerance of the live edge")
        XCTAssertEqual(t.plan(seekTo: 2400, seekable: encoded), .restart(media: 2400), "beyond what's encoded")
        XCTAssertEqual(t.plan(seekTo: 600, seekable: encoded), .restart(media: 600), "before the stream's start")
        XCTAssertEqual(t.plan(seekTo: 1800, seekable: encoded), .inPlace(stream: 0))
        XCTAssertEqual(t.plan(seekTo: 1860, seekable: []), .restart(media: 1860), "nothing seekable yet")
        XCTAssertEqual(t.plan(seekTo: -5, seekable: encoded), .restart(media: 0))
    }
}

@MainActor
final class ServerStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suite = "strata.tests.\(UUID().uuidString)"

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suite)
    }

    private func info(id: String = "srv-1", setup: Bool = false, api: Int = 1) -> StubProtocol.Reply {
        .json(200, ["name": "strata", "serverName": "Den", "id": id, "version": "0.1.0", "apiVersion": api, "setupRequired": setup])
    }

    func testProbeNormalisesAddress() async throws {
        StubProtocol.reset { _ in self.info() }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        let info = try await store.probe(" 192.168.1.20 ")
        XCTAssertEqual(info.serverName, "Den")
        XCTAssertEqual(StubProtocol.recorded.first?.url?.absoluteString, "http://192.168.1.20:8420/api/info")
    }

    func testProbeTriesHTTPSFirstThenAHomeServerOnlyWhenNothingListens() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())

        // Nothing on 443: a home server on Strata's port.
        StubProtocol.reset { req in
            if req.url?.scheme == "https" { throw URLError(.cannotConnectToHost) }
            return self.info()
        }
        let (url, _) = try await store.probeServer("strata.example.com")
        XCTAssertEqual(url.absoluteString, "http://strata.example.com:8420")
        XCTAssertEqual(StubProtocol.recorded.map { $0.url!.scheme! }, ["https", "http"])

        // Something answered on 443 (a bad certificate, an error page): never plain HTTP.
        for failure in [{ throw URLError(.serverCertificateUntrusted) }, { StubProtocol.Reply.json(503, ["error": "down"]) }] as [() throws -> StubProtocol.Reply] {
            StubProtocol.reset { req in req.url?.scheme == "https" ? try failure() : self.info() }
            do {
                _ = try await store.probeServer("strata.example.com")
                XCTFail("expected the HTTPS failure")
            } catch {}
            XCTAssertEqual(StubProtocol.recorded.map { $0.url!.scheme! }, ["https"])
        }

        StubProtocol.reset { _ in self.info() }
        let (secure, _) = try await store.probeServer("strata.example.com")
        XCTAssertEqual(secure.absoluteString, "https://strata.example.com")
    }

    func testLocalAddresses() {
        for local in ["http://192.168.1.20:8420", "http://10.0.0.5", "http://localhost:8420", "http://127.0.0.1:8470", "http://[fd7a:115c::1]", "http://[fe80::1]", "http://[::1]"] {
            XCTAssertTrue(ServerAddress.isLocal(URL(string: local)!), local)
        }
        for remote in ["http://nas.local", "http://nas:8420", "http://strata.example.com", "http://8.8.8.8", "http://172.32.0.1", "http://100.64.0.7", "http://10.1.2.3.example.com", "http://192.168.1.1.evil.test", "http://[2001:db8::1]"] {
            XCTAssertFalse(ServerAddress.isLocal(URL(string: remote)!), remote)
        }
    }

    func testHiddenServersStayHiddenUntilShownOrSignedInTo() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let tokens = TokenStorage.inMemory()
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        store.hideServers(["srv-1", "srv-2"])
        XCTAssertEqual(ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session()).hiddenServerIDs, ["srv-1", "srv-2"])
        store.showHiddenServers("srv-2")
        XCTAssertEqual(store.hiddenServerIDs, ["srv-1"])

        // Signing in to a hidden server brings it back.
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/auth/sign-in/username": return .json(200, ["token": "t1"])
            case "/api/me": return self.me("sehal")
            default: return .json(200, ["success": true])
            }
        }
        _ = await store.signIn(address: "den.local", login: "sehal", password: "pw")
        XCTAssertEqual(store.hiddenServerIDs, [])
        store.hideServer("srv-9")
        store.showHiddenServers()
        XCTAssertTrue(store.hiddenServerIDs.isEmpty)
    }

    func testProbeRejectsOtherServers() async throws {
        StubProtocol.reset { _ in .json(200, ["name": "jellyfin", "serverName": "x", "id": "x", "version": "1", "apiVersion": 1, "setupRequired": false]) }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        do {
            _ = try await store.probe("10.0.0.1")
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .notStrata)
        }
        StubProtocol.reset { _ in self.info(api: 2) }
        do {
            _ = try await store.probe("10.0.0.1")
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .incompatible)
        }
        do {
            _ = try await store.probe("")
            XCTFail("expected error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .invalidInput)
        }
    }

    /// `/api/me` for `user` in `household` (nil: none chosen yet).
    private func me(_ user: String, household: String? = "h1", householdName: String = "Home", kids: Bool = false, viewerOnly: Bool = false) -> StubProtocol.Reply {
        .json(200, [
            "user": ["id": user, "username": user, "name": user.capitalized, "email": "\(user)@x.test", "isServerAdmin": user == "sehal"],
            "viewerOnly": viewerOnly,
            "household": household.map { ["id": $0, "name": householdName, "role": "owner", "contentLimit": kids ? "kids" : "none", "isKids": kids] as Any } ?? NSNull(),
        ])
    }

    private func bearer(_ req: URLRequest) -> String {
        (req.value(forHTTPHeaderField: "Authorization") ?? "").replacingOccurrences(of: "Bearer ", with: "")
    }

    func testSignInSavesAndRestoresTheAccount() async throws {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/auth/sign-in/username":
                return StubProtocol.Reply(status: 200, body: Data(#"{"token":"raw"}"#.utf8), headers: ["Content-Type": "application/json", "set-auth-token": "t1"])
            case "/api/me": return self.me("sehal")
            default: return .json(404, ["error": "Not found"])
            }
        }
        let tokens = TokenStorage.inMemory()
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        XCTAssertFalse(store.isSignedIn)
        let ok = await store.signIn(address: "den.local", login: "sehal", password: "pw")
        XCTAssertTrue(ok, store.lastError ?? "")
        XCTAssertTrue(store.isSignedIn)
        XCTAssertFalse(store.needsHousehold)
        XCTAssertEqual(store.active?.id, "srv-1|sehal")
        XCTAssertEqual(store.active?.name, "Sehal")
        XCTAssertEqual(store.active?.household?.name, "Home")
        XCTAssertEqual(store.active?.isServerAdmin, true)
        XCTAssertEqual(store.activeServer?.url.absoluteString, "http://den.local:8420")
        XCTAssertEqual(store.client?.token, "t1")
        XCTAssertEqual(tokens.read("srv-1|sehal"), "t1")

        // A fresh store restores the sign-in and its token.
        let restored = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        XCTAssertEqual(restored.active?.id, "srv-1|sehal")
        XCTAssertEqual(restored.active?.household?.id, "h1")
        XCTAssertEqual(restored.client?.baseURL.absoluteString, "http://den.local:8420")

        // Signing in again via another address keeps one sign-in, one server with both
        // addresses, and ends the old session.
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/auth/sign-in/username": return .json(200, ["token": "t2"])
            case "/api/me": return self.me("sehal")
            default: return .json(200, ["success": true])
            }
        }
        _ = await store.signIn(address: "100.64.0.7", login: "sehal", password: "pw")
        XCTAssertEqual(store.signIns.count, 1)
        XCTAssertEqual(store.servers.count, 1)
        XCTAssertEqual(store.activeServer?.addresses.map(\.absoluteString), ["http://100.64.0.7:8420", "http://den.local:8420"])
        XCTAssertEqual(store.client?.token, "t2")
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(StubProtocol.recorded.contains { $0.url?.path == "/api/auth/sign-out" && self.bearer($0) == "t1" })

        await store.signOut()
        XCTAssertFalse(store.isSignedIn)
        XCTAssertTrue(store.signIns.isEmpty)
        XCTAssertTrue(store.servers.isEmpty)
        XCTAssertNil(tokens.read("srv-1|sehal"))
    }

    func testSignInFailureSetsLastError() async {
        StubProtocol.reset { req in
            req.url?.path == "/api/info" ? self.info() : .json(401, ["message": "Invalid username or password", "code": "INVALID_USERNAME_OR_PASSWORD"])
        }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        let ok = await store.signIn(address: "den.local", login: "x", password: "y")
        XCTAssertFalse(ok)
        XCTAssertEqual(store.lastError, "Wrong username or password.")
        XCTAssertFalse(store.isSignedIn)

        StubProtocol.reset { req in req.url?.path == "/api/info" ? self.info() : .json(429, ["message": "Too many requests. Please try again later."]) }
        _ = await store.signIn(address: "den.local", login: "x", password: "y")
        XCTAssertEqual(store.lastError, "Too many requests. Please try again later.")

        StubProtocol.reset { _ in self.info(setup: true) }
        _ = await store.signIn(address: "den.local", login: "x", password: "y")
        XCTAssertTrue(store.lastError?.contains("hasn't been set up") == true)
    }

    /// Several people on one device, on two servers: "Who's watching?" switches between them.
    func testSavedSignInsAcrossServersAndAccounts() async throws {
        let tokens = TokenStorage.inMemory()
        StubProtocol.reset { req in
            let host = req.url?.host ?? ""
            switch req.url?.path {
            case "/api/info": return self.info(id: host.hasPrefix("b") ? "srv-b" : "srv-a")
            case "/api/auth/sign-in/username":
                let user = req.jsonBody?["username"] as? String ?? "?"
                return .json(200, ["token": "tok-\(host)-\(user)"])
            case "/api/me":
                // The token names the account: "tok-<host>-<user>".
                let user = self.bearer(req).split(separator: "-").last.map(String.init) ?? "?"
                return self.me(user, household: host.hasPrefix("b") ? "hb" : "ha", kids: user == "kid")
            default: return .json(200, ["success": true])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        _ = await store.signIn(address: "a.local", login: "sehal", password: "p")
        _ = await store.signIn(address: "a.local", login: "kid", password: "p")
        _ = await store.signIn(address: "b.local", login: "sehal", password: "p")
        XCTAssertEqual(store.signIns.map(\.id), ["srv-a|sehal", "srv-a|kid", "srv-b|sehal"])
        XCTAssertEqual(store.servers.map(\.id), ["srv-a", "srv-b"])
        XCTAssertEqual(store.signIns(onServer: "srv-a").count, 2)
        XCTAssertEqual(store.active?.id, "srv-b|sehal")
        XCTAssertEqual(store.signIns[1].isKids, true)

        store.switchTo("srv-a|kid")
        XCTAssertEqual(store.client?.token, "tok-a.local-kid")
        XCTAssertEqual(store.client?.baseURL.host, "a.local")
        XCTAssertEqual(store.client(forSignIn: "srv-b|sehal")?.token, "tok-b.local-sehal")

        // Several left: a fresh launch keeps the one in use.
        let restored = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        XCTAssertEqual(restored.active?.id, "srv-a|kid")

        // Signing the active one out asks who's watching (several remain)…
        await store.signOut()
        XCTAssertNil(store.activeID)
        XCTAssertFalse(store.isSignedIn)
        XCTAssertEqual(store.signIns.count, 2)
        store.switchTo("srv-a|sehal")
        XCTAssertEqual(store.client?.token, "tok-a.local-sehal")
        // …and removing another leaves one, which is who's watching. Server b goes with its
        // only sign-in.
        store.remove("srv-b|sehal")
        XCTAssertEqual(store.servers.map(\.id), ["srv-a"])
        XCTAssertNil(tokens.read("srv-b|sehal"))
        store.deactivate()
        XCTAssertNil(store.active)
        let single = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        XCTAssertEqual(single.active?.id, "srv-a|sehal", "with one sign-in saved there's no one else to ask about")
    }

    func testHouseholdChoice() async throws {
        var active: String?
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/auth/sign-in/username": return .json(200, ["token": "t"])
            case "/api/me": return self.me("sehal", household: active, householdName: active == "h2" ? "Cabin" : "Home")
            case "/api/auth/organization/list": return .json(200, [["id": "h1", "name": "Home", "slug": "home"], ["id": "h2", "name": "Cabin", "slug": "cabin"]])
            case "/api/auth/organization/set-active":
                active = req.jsonBody?["organizationId"] as? String
                return .json(200, ["id": active ?? "", "name": "x"])
            case "/api/home": return active == nil ? .json(409, ["error": "Choose a household first"]) : .fixture("home")
            default: return .json(404, ["error": "Not found"])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        _ = await store.signIn(address: "den.local", login: "sehal", password: "p")
        XCTAssertTrue(store.needsHousehold, "an account in two households starts with neither")
        let households = try await store.households()
        XCTAssertEqual(households.map(\.name), ["Home", "Cabin"])
        try await store.chooseHousehold("h2")
        XCTAssertFalse(store.needsHousehold)
        XCTAssertEqual(store.active?.household?.name, "Cabin")

        // The server forgot it (another device switched this session's household away):
        // a 409 brings the picker back.
        active = nil
        do {
            _ = try await XCTUnwrap(store.client).home()
            XCTFail("expected 409")
        } catch {
            let retry = await store.recover(from: error)
            XCTAssertFalse(retry)
            XCTAssertTrue(store.needsHousehold)
        }
    }

    func testHomeJoinPicksAMember() async throws {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/join":
                if let user = req.jsonBody?["userId"] as? String { return .json(200, ["token": "join-\(user)"]) }
                return .fixture("join_choices")
            case "/api/me": return self.me(self.bearer(req).replacingOccurrences(of: "join-", with: ""), viewerOnly: true)
            default: return .json(404, ["error": "Not found"])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        let (url, info) = try await store.probeServer("den.local")
        let choices = try await store.homeJoinChoices(url: url)
        let member = try XCTUnwrap(choices.members.first)
        let ok = await store.join(url: url, info: info, userId: member.id)
        XCTAssertTrue(ok, store.lastError ?? "")
        XCTAssertEqual(store.active?.userID, member.id)
        XCTAssertEqual(store.active?.viewerOnly, true)
        XCTAssertEqual(store.client?.token, "join-\(member.id)")
    }

    func testCodeSignInAndPasswordChange() async throws {
        var token = "tv"
        var householdSet = true
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/me": return self.bearer(req) == token ? self.me("sehal", household: householdSet ? "h1" : nil) : .json(401, ["error": "Not signed in"])
            case "/api/auth/change-password":
                // The account has several households: the new session starts without one.
                token = "fresh"
                householdSet = false
                return .json(200, ["token": "fresh"])
            case "/api/auth/organization/set-active":
                householdSet = true
                return .json(200, ["id": "h1"])
            default: return .json(404, ["error": "Not found"])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        let (url, info) = try await store.probeServer("den.local")
        let ok = await store.signIn(token: "tv", url: url, info: info)
        XCTAssertTrue(ok)
        XCTAssertEqual(store.active?.household?.id, "h1")

        // A new password: this device carries on with the new session, in the same household.
        try await store.changePassword(current: "old-pass", new: "new-pass")
        XCTAssertEqual(store.client?.token, "fresh")
        XCTAssertEqual(store.active?.household?.id, "h1")
        XCTAssertTrue(StubProtocol.recorded.contains { $0.url?.path == "/api/auth/organization/set-active" && $0.jsonBody?["organizationId"] as? String == "h1" })
    }

    func testMultipleAddressesFailover() async throws {
        let tokens = TokenStorage.inMemory()
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info(id: "srv-a")
            case "/api/auth/sign-in/username": return .json(200, ["token": "tok"])
            case "/api/me": return self.me("u")
            default: return .json(200, ["success": true])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        _ = await store.signIn(address: "a.local", login: "u", password: "p")
        try await store.addAddress("a2.local", to: "srv-a")
        XCTAssertEqual(store.activeServer?.addresses.count, 2)
        // a.local (preferred) goes down; recover() should switch to a2.local.
        StubProtocol.reset { req in
            if req.url?.host == "a.local" { throw URLError(.cannotConnectToHost) }
            switch req.url?.path {
            case "/api/info": return self.info(id: "srv-a")
            case "/api/me": return self.me("u")
            default: return .json(200, ["success": true])
            }
        }
        let changed = await store.recover(from: StrataError(kind: .network, message: "x"))
        XCTAssertTrue(changed)
        XCTAssertEqual(store.client?.baseURL.host, "a2.local")
        let ok = await store.connect()
        XCTAssertTrue(ok)
        XCTAssertEqual(store.savedServer(matching: "http://a2.local:8420")?.id, "srv-a")
        XCTAssertEqual(store.savedServer(matching: "srv-a")?.id, "srv-a")
        XCTAssertNil(store.savedServer(matching: "http://evil.example"))
    }

    func testExpiredTokenSignsOut() async {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/auth/sign-in/username": return .json(200, ["token": "t"])
            case "/api/me": return self.me("u")
            default: return .json(200, ["success": true])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        _ = await store.signIn(address: "den.local", login: "u", password: "p")
        XCTAssertTrue(store.isSignedIn)
        StubProtocol.reset { req in req.url?.path == "/api/info" ? self.info() : .json(401, ["error": "Not signed in"]) }
        let ok = await store.connect()
        XCTAssertFalse(ok)
        XCTAssertFalse(store.isSignedIn)
        XCTAssertTrue(store.signIns.isEmpty)
        XCTAssertTrue(store.lastError?.contains("expired") == true)
    }

    /// Sign-ins from before accounts (a token per server, bound to a profile) are dropped.
    func testProfileEraSignInsAreDropped() {
        let tokens = TokenStorage.inMemory()
        tokens.write("old-token", "srv-old")
        defaults.set(try! JSONSerialization.data(withJSONObject: [["id": "srv-old", "name": "Den", "addresses": ["http://den.local:8420"], "username": "sehal", "profileId": 1]]),
                     forKey: "strata.servers")
        defaults.set("srv-old", forKey: "strata.activeServer")
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        XCTAssertFalse(store.isSignedIn)
        XCTAssertTrue(store.signIns.isEmpty)
        XCTAssertNil(tokens.read("srv-old"))
        XCTAssertNil(defaults.data(forKey: "strata.servers"))
        XCTAssertNil(defaults.string(forKey: "strata.activeServer"))
    }

    func testLegacyKeysAreCleaned() {
        defaults.set("abc", forKey: "strata.userId")
        defaults.set("tok", forKey: "strata.accessToken.fallback.abc")
        defaults.set("http://x", forKey: "strata.serverURL")
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        XCTAssertFalse(store.isSignedIn)
        XCTAssertNil(defaults.string(forKey: "strata.userId"))
        XCTAssertNil(defaults.string(forKey: "strata.accessToken.fallback.abc"))
        XCTAssertNil(defaults.string(forKey: "strata.serverURL"))
    }
}
