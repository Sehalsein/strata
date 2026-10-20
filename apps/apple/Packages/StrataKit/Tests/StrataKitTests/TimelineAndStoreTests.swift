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

    func testSignInProfilesAndPersistence() async throws {
        var selected = false
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/auth/login": return .json(200, ["token": "t1"])
            case "/api/me":
                return .json(200, ["user": ["id": 1, "username": "sehal", "isAdmin": true],
                                   "profile": selected ? (["id": 2, "name": "Kids", "avatar": NSNull()] as Any) : NSNull()])
            case "/api/profiles": return .fixture("profiles")
            case "/api/profiles/2/select":
                selected = true
                return .json(200, ["ok": true])
            default: return .json(404, ["error": "Not found"])
            }
        }
        let tokens = TokenStorage.inMemory()
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        XCTAssertFalse(store.isSignedIn)
        let ok = await store.signIn(address: "den.local", username: "sehal", password: "pw")
        XCTAssertTrue(ok, store.lastError ?? "")
        XCTAssertTrue(store.isSignedIn)
        XCTAssertTrue(store.needsProfileSelection)
        XCTAssertEqual(store.active?.url.absoluteString, "http://den.local:8420")
        XCTAssertEqual(store.client?.token, "t1")
        let login = try XCTUnwrap(StubProtocol.recorded.first { $0.url?.path == "/api/auth/login" })
        XCTAssertNotNil(login.jsonBody?["deviceName"] as? String)

        let profiles = try await store.profiles()
        XCTAssertEqual(profiles.count, 2)
        try await store.selectProfile(id: 2, pin: "1234")
        XCTAssertFalse(store.needsProfileSelection)
        XCTAssertEqual(store.active?.profileName, "Kids")

        // A fresh store restores the server, token and profile.
        let restored = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        XCTAssertEqual(restored.active?.id, "srv-1")
        XCTAssertEqual(restored.active?.profileId, 2)
        XCTAssertFalse(restored.needsProfileSelection)
        XCTAssertEqual(restored.client?.baseURL.absoluteString, "http://den.local:8420")

        // Signing in again via another address keeps one entry with both addresses.
        _ = await store.signIn(address: "100.64.0.7", username: "sehal", password: "pw")
        XCTAssertEqual(store.servers.count, 1)
        XCTAssertEqual(store.active?.addresses.map(\.absoluteString), ["http://100.64.0.7:8420", "http://den.local:8420"])

        await store.signOut()
        XCTAssertFalse(store.isSignedIn)
        XCTAssertTrue(store.servers.isEmpty)
        XCTAssertNil(tokens.read("srv-1"))
    }

    func testSignInFailureSetsLastError() async {
        StubProtocol.reset { req in
            req.url?.path == "/api/info" ? self.info() : .json(401, ["error": "Wrong username or password"])
        }
        let store = ServerStore(defaults: defaults, tokens: .inMemory(), session: StubProtocol.session())
        let ok = await store.signIn(address: "den.local", username: "x", password: "y")
        XCTAssertFalse(ok)
        XCTAssertEqual(store.lastError, "Wrong username or password.")
        XCTAssertFalse(store.isSignedIn)

        StubProtocol.reset { _ in self.info(setup: true) }
        _ = await store.signIn(address: "den.local", username: "x", password: "y")
        XCTAssertTrue(store.lastError?.contains("hasn't been set up") == true)
    }

    func testMultipleServersSwitchAndFailover() async throws {
        let tokens = TokenStorage.inMemory()
        StubProtocol.reset { req in
            let host = req.url?.host ?? ""
            switch req.url?.path {
            case "/api/info": return self.info(id: host.hasPrefix("b") ? "srv-b" : "srv-a")
            case "/api/auth/login": return .json(200, ["token": "tok-\(host)"])
            case "/api/me": return .json(200, ["user": ["id": 1, "username": "u", "isAdmin": false], "profile": ["id": 1, "name": "u", "avatar": NSNull()]])
            default: return .json(200, ["ok": true])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        _ = await store.signIn(address: "a.local", username: "u", password: "p")
        _ = await store.signIn(address: "b.local", username: "u", password: "p")
        XCTAssertEqual(store.servers.map(\.id), ["srv-a", "srv-b"])
        XCTAssertEqual(store.active?.id, "srv-b")
        XCTAssertFalse(store.needsProfileSelection)
        store.switchServer("srv-a")
        XCTAssertEqual(store.client?.token, "tok-a.local")

        // Prefer an unreachable LAN address; connect() falls back to the working one.
        try await store.addAddress("a2.local", to: "srv-a")
        XCTAssertEqual(store.active?.addresses.count, 2)
        // a.local (preferred) goes down; recover() should switch to a2.local.
        StubProtocol.reset { req in
            if req.url?.host == "a.local" { throw URLError(.cannotConnectToHost) }
            switch req.url?.path {
            case "/api/info": return self.info(id: "srv-a")
            case "/api/me": return .json(200, ["user": ["id": 1, "username": "u", "isAdmin": false], "profile": ["id": 1, "name": "u", "avatar": NSNull()]])
            default: return .json(200, ["ok": true])
            }
        }
        let changed = await store.recover(from: StrataError(kind: .network, message: "x"))
        XCTAssertTrue(changed)
        XCTAssertEqual(store.client?.baseURL.host, "a2.local")
        let ok = await store.connect()
        XCTAssertTrue(ok)

        store.removeServer("srv-b")
        XCTAssertEqual(store.servers.map(\.id), ["srv-a"])
    }

    func testExpiredTokenSignsOut() async {
        let tokens = TokenStorage.inMemory()
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/info": return self.info()
            case "/api/auth/login": return .json(200, ["token": "t"])
            case "/api/me": return .json(200, ["user": ["id": 1, "username": "u", "isAdmin": false], "profile": NSNull()])
            default: return .json(200, ["ok": true])
            }
        }
        let store = ServerStore(defaults: defaults, tokens: tokens, session: StubProtocol.session())
        _ = await store.signIn(address: "den.local", username: "u", password: "p")
        XCTAssertTrue(store.isSignedIn)
        StubProtocol.reset { req in req.url?.path == "/api/info" ? self.info() : .json(401, ["error": "Not signed in"]) }
        let ok = await store.connect()
        XCTAssertFalse(ok)
        XCTAssertFalse(store.isSignedIn)
        XCTAssertTrue(store.lastError?.contains("expired") == true)
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
