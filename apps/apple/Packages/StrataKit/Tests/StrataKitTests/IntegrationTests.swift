import XCTest
@testable import StrataKit

/// Runs `StrataClient` and `ServerStore` against a real, freshly started server (no TMDB
/// key), from the same machine so first-run setup needs no code and home join is allowed.
/// Skipped unless `STRATA_TEST_SERVER` is set, e.g.:
///
///     cd apps/server && STRATA_NO_JOBS=1 bun src/main.ts serve --data-dir /tmp/strata-it --port 8451 &
///     STRATA_TEST_SERVER=http://127.0.0.1:8451 swift test --filter IntegrationTests
final class IntegrationTests: XCTestCase {
    private static let login = "kit"
    private static var password = "integration-pass"

    private func server() throws -> URL {
        guard let address = ProcessInfo.processInfo.environment["STRATA_TEST_SERVER"] else {
            throw XCTSkip("set STRATA_TEST_SERVER to run")
        }
        return try XCTUnwrap(ServerAddress.normalize(address))
    }

    /// Sets the server up on first run. Setup's token is a full sign-in, which spares one
    /// of the ten password sign-ins Better Auth allows an address per 15 minutes.
    @discardableResult
    private func setUp(_ anon: StrataClient) async throws -> String? {
        guard try await anon.isSetupRequired() else { return nil }
        return try await anon.setupAdmin(username: Self.login, password: Self.password, householdName: "Kit's home")
    }

    /// Sets the server up (first run) or signs in to it; returns a signed-in client.
    private func signedIn(_ anon: StrataClient) async throws -> StrataClient {
        if let token = try await setUp(anon) { return anon.withToken(token) }
        return anon.withToken(try await anon.signIn(login: Self.login, password: Self.password))
    }

    func testSignInHouseholdAndCatalog() async throws {
        let anon = StrataClient(baseURL: try server(), cacheTTL: 0)
        let info = try await anon.info()
        XCTAssertEqual(info.name, "strata")
        XCTAssertTrue(info.isCompatible)
        XCTAssertEqual(info.mode, "home")

        let client = try await signedIn(anon)
        let notSetUp = try await anon.isSetupRequired()
        XCTAssertFalse(notSetUp)

        // Wrong password → a readable 401 with Better Auth's code.
        do {
            _ = try await anon.signIn(login: Self.login, password: "nope-nope")
            XCTFail("expected 401")
        } catch let e as StrataError {
            XCTAssertEqual(e.status, 401)
            XCTAssertEqual(e.code, "INVALID_USERNAME_OR_PASSWORD")
        }

        // The account's only household opens by itself.
        let me = try await client.me()
        XCTAssertEqual(me.user.username, Self.login)
        XCTAssertTrue(me.user.isServerAdmin)
        XCTAssertFalse(me.viewerOnly)
        let household = try XCTUnwrap(me.household)
        XCTAssertTrue(household.isOwner)
        let households = try await client.households()
        XCTAssertEqual(households.map(\.id), [household.id])
        try await client.setActiveHousehold(household.id)

        // Without a TMDB key, home still answers (library shelves only)…
        let shelves = try await client.home()
        XCTAssertTrue(shelves.allSatisfy { $0.kind == .continue || $0.kind == .titles })
        // …and progress and lists follow the account.
        let sources = try await client.sources(.movie(10378))
        XCTAssertTrue(sources.isEmpty)
        let progress = try await client.reportProgress(.movie(10378), positionMs: 1000, durationMs: 60_000)
        XCTAssertEqual(progress.positionMs, 1000)
        try await client.setWatchlist(.movie, tmdbId: 10378, true)
        try await client.setWatched(.movie(10378), true)

        try await client.signOut()
        do {
            _ = try await client.me()
            XCTFail("expected 401 after sign-out")
        } catch let e as StrataError {
            XCTAssertTrue(e.isUnauthorized)
        }
    }

    /// The TV asks for a code, a signed-in phone opens and approves it, the TV's next poll
    /// gets a watch-only session in the phone's household.
    func testTVSignsInByCode() async throws {
        let url = try server()
        let phone = try await signedIn(StrataClient(baseURL: url, cacheTTL: 0))
        let tv = StrataClient(baseURL: url, cacheTTL: 0)

        let code = try await tv.startDeviceCode()
        XCTAssertEqual(code.userCode.count, 8)
        XCTAssertEqual(code.qrURL(server: url)?.path, "/link")
        let first = try await tv.pollDeviceCode(code.deviceCode)
        XCTAssertEqual(first, .pending)

        // Typed as shown on the TV, with its dash.
        let status = try await phone.deviceCodeStatus(userCode: code.displayCode.lowercased())
        XCTAssertTrue(status.isPending)
        try await phone.approveDevice(userCode: code.displayCode)

        var token: String?
        for _ in 0..<10 {
            try await Task.sleep(for: .seconds(Double(code.interval) + 0.2))
            switch try await tv.pollDeviceCode(code.deviceCode) {
            case .approved(let t): token = t
            case .pending, .slowDown: continue
            case let other: XCTFail("unexpected \(other)")
            }
            if token != nil { break }
        }
        let tvClient = tv.withToken(try XCTUnwrap(token))
        let me = try await tvClient.me()
        let phoneMe = try await phone.me()
        XCTAssertTrue(me.viewerOnly)
        XCTAssertEqual(me.user.id, phoneMe.user.id)
        XCTAssertEqual(me.household?.id, phoneMe.household?.id)
        XCTAssertFalse(me.user.isServerAdmin, "a TV can watch, never administer")
        _ = try await tvClient.home()

        // A code nobody approves can be declined.
        let other = try await tv.startDeviceCode()
        _ = try await phone.deviceCodeStatus(userCode: other.userCode)
        try await phone.denyDevice(userCode: other.userCode)
        try await Task.sleep(for: .seconds(Double(other.interval) + 0.2))
        let denied = try await tv.pollDeviceCode(other.deviceCode)
        XCTAssertEqual(denied, .denied)
    }

    /// Through `ServerStore`, as the app does it: sign in, home join as a member, switch
    /// between the saved sign-ins, change the password, sign out.
    @MainActor
    func testStoreFlows() async throws {
        let url = try server()
        try await setUp(StrataClient(baseURL: url, cacheTTL: 0))
        let suite = "strata.it.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ServerStore(defaults: defaults, tokens: .inMemory())

        let ok = await store.signIn(address: url.absoluteString, login: Self.login, password: Self.password)
        XCTAssertTrue(ok, store.lastError ?? "")
        XCTAssertFalse(store.needsHousehold)
        let connected = await store.connect()
        XCTAssertTrue(connected)
        let mine = try XCTUnwrap(store.active)

        // From the server's own machine, home join is open: pick a member, no password.
        let (_, info) = try await store.probeServer(url.absoluteString)
        XCTAssertEqual(info.localJoin, true)
        let choices = try await store.homeJoinChoices(url: url)
        let member = try XCTUnwrap(choices.members.first { $0.name == Self.login })
        let joined = await store.join(url: url, info: info, userId: member.id)
        XCTAssertTrue(joined, store.lastError ?? "")
        // Same account and server: the one saved sign-in, now watch-only.
        XCTAssertEqual(store.signIns.count, 1)
        XCTAssertEqual(store.active?.viewerOnly, true)
        XCTAssertEqual(store.active?.household?.id, mine.household?.id)

        // Sign in with the password again (a full session), then change the password: this
        // device carries on with the new session; other sessions end.
        _ = await store.signIn(address: url.absoluteString, login: Self.login, password: Self.password)
        let other = StrataClient(baseURL: url, token: try await StrataClient(baseURL: url, cacheTTL: 0).signIn(login: Self.login, password: Self.password), cacheTTL: 0)
        let newPassword = "integration-pass-\(Int.random(in: 1000...9999))"
        try await store.changePassword(current: Self.password, new: newPassword)
        Self.password = newPassword
        let stillMe = try await XCTUnwrap(store.client).me()
        XCTAssertEqual(stillMe.user.id, mine.userID)
        XCTAssertEqual(stillMe.household?.id, mine.household?.id)
        do {
            _ = try await other.me()
            XCTFail("other sessions should end with a new password")
        } catch let e as StrataError {
            XCTAssertTrue(e.isUnauthorized)
        }

        await store.signOut()
        XCTAssertTrue(store.signIns.isEmpty)
        XCTAssertFalse(store.isSignedIn)
    }
}

/// Finds a real server over Bonjour. Skipped unless `STRATA_TEST_BONJOUR` is set to the
/// port the server listens on (Bonjour advertising is on by default).
@MainActor
final class BonjourIntegrationTests: XCTestCase {
    func testBrowserResolvesServer() async throws {
        guard let port = ProcessInfo.processInfo.environment["STRATA_TEST_BONJOUR"].flatMap(Int.init) else {
            throw XCTSkip("set STRATA_TEST_BONJOUR to run")
        }
        let browser = ServerBrowser()
        browser.start()
        defer { browser.stop() }
        var found: DiscoveredServer?
        for _ in 0..<100 {
            found = browser.servers.first { $0.url.port == port }
            if found != nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let server = try XCTUnwrap(found, "no server on port \(port); state=\(browser.state), seen=\(browser.servers)")
        XCTAssertEqual(server.apiVersion, 1)
        XCTAssertFalse(server.url.host?.contains(":") ?? true, "prefers IPv4: \(server.url)")
        let info = try await StrataClient(baseURL: server.url, cacheTTL: 0).info()
        XCTAssertEqual(info.id, server.id)
    }
}
