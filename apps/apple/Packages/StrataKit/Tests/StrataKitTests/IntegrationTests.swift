import XCTest
@testable import StrataKit

/// Runs `StrataClient` against a real, freshly started server with no TMDB key.
/// Skipped unless `STRATA_TEST_SERVER` is set, e.g.:
///
///     cd apps/server && STRATA_NO_JOBS=1 bun src/main.ts --data-dir /tmp/strata-it --port 8451 &
///     STRATA_TEST_SERVER=http://127.0.0.1:8451 swift test --filter IntegrationTests
final class IntegrationTests: XCTestCase {
    func testAgainstRealServer() async throws {
        guard let address = ProcessInfo.processInfo.environment["STRATA_TEST_SERVER"] else {
            throw XCTSkip("set STRATA_TEST_SERVER to run")
        }
        let url = try XCTUnwrap(ServerAddress.normalize(address))
        let anon = StrataClient(baseURL: url, cacheTTL: 0)

        let info = try await anon.info()
        XCTAssertEqual(info.name, "strata")
        XCTAssertTrue(info.isCompatible)

        if info.setupRequired {
            _ = try await anon.setupAdmin(username: "kit", password: "integration-pass")
        }
        let notSetUp = try await anon.isSetupRequired()
        XCTAssertFalse(notSetUp)

        // Wrong password → readable 401.
        do {
            _ = try await anon.login(username: "kit", password: "nope")
            XCTFail("expected 401")
        } catch let e as StrataError {
            XCTAssertEqual(e.status, 401)
            XCTAssertEqual(e.message, "Wrong username or password")
        }

        let token = try await anon.login(username: "kit", password: "integration-pass", deviceName: "StrataKit tests")
        let client = anon.withToken(token)

        let me = try await client.me()
        XCTAssertEqual(me.user.username, "kit")
        let profiles = try await client.profiles()
        XCTAssertFalse(profiles.isEmpty)
        try await client.selectProfile(id: profiles[0].id)
        let meAfter = try await client.me()
        XCTAssertEqual(meAfter.profile?.id, profiles[0].id)

        // Without a TMDB key, home still answers (library shelves only)...
        let shelves = try await client.home()
        XCTAssertTrue(shelves.allSatisfy { $0.kind == .continue || $0.kind == .titles })
        // ...but TMDB-backed endpoints surface the server's error as a readable StrataError.
        do {
            _ = try await client.movie(10378)
            XCTFail("expected a TMDB error")
        } catch let e as StrataError {
            XCTAssertEqual(e.kind, .http)
            XCTAssertEqual(e.status, 503)
            XCTAssertEqual(e.message, "The movie catalog isn't set up yet. Add a TMDB key in the server dashboard.")
        }
        do {
            _ = try await client.search("bunny")
            XCTFail("expected a TMDB error")
        } catch let e as StrataError {
            XCTAssertEqual(e.status, 503)
        }

        // Nothing in the library → play is a readable 404.
        do {
            _ = try await client.play(.movie(10378))
            XCTFail("expected 404")
        } catch let e as StrataError {
            XCTAssertEqual(e.status, 404)
            XCTAssertEqual(e.message, "No source available for this title")
        }
        let sources = try await client.sources(.movie(10378))
        XCTAssertTrue(sources.isEmpty)
        let progress = try await client.reportProgress(.movie(10378), positionMs: 1000, durationMs: 60_000)
        XCTAssertEqual(progress.positionMs, 1000)
        try await client.setWatchlist(.movie, tmdbId: 10378, true)
        try await client.setWatched(.movie(10378), true)

        try await client.logout()
        do {
            _ = try await client.me()
            XCTFail("expected 401 after logout")
        } catch let e as StrataError {
            XCTAssertTrue(e.isUnauthorized)
        }
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
