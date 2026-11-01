import Foundation
import Security
import XCTest
@testable import StrataKit

final class TitleActionsTests: XCTestCase {
    private let base = URL(string: "http://strata.test:8420")!
    private func client(ttl: TimeInterval = 0) -> StrataClient {
        StrataClient(baseURL: base, token: "tok", session: StubProtocol.session(), cacheTTL: ttl)
    }

    /// A fixture with some top-level fields changed (`NSNull()` for null).
    private func fixture<T: Decodable>(_ type: T.Type, _ name: String, _ changes: [String: Any] = [:]) throws -> T {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Fixture.data(name)) as? [String: Any])
        object.merge(changes) { $1 }
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: object))
    }

    private var paths: [String] { StubProtocol.recorded.map { [$0.url!.path, $0.url!.query].compactMap { $0 }.joined(separator: "?") } }

    // MARK: - Play

    func testMovieInLibraryPlaysFromLibrary() async throws {
        let movie = try Fixture.decode(MovieDetail.self, "movie_full") // in the library, part watched
        let now = try XCTUnwrap(TitleActions.libraryPlay(movie).choice)
        XCTAssertEqual(now, PlayChoice(label: "Resume", target: .movie(.tmdb(.movie, 10378)), subtitle: "2008"))

        StubProtocol.reset { _ in .fixture("sources") }
        let options = await TitleActions(client: client()).play(movie)
        XCTAssertEqual(options.choice, now, "the library plays it: no source picked")
        XCTAssertEqual(options.sources.map(\.id), ["file:1"])
        XCTAssertTrue(options.asked)
        XCTAssertFalse(options.lookedFurther)
        XCTAssertEqual(paths, ["/api/sources?mediaType=movie&tmdbId=10378"], "the library alone is asked")
    }

    func testMovieNotInLibraryPlaysFirstDiscoveredSource() async throws {
        let movie = try fixture(MovieDetail.self, "movie_full", ["available": [], "progress": NSNull()])
        XCTAssertNil(TitleActions.libraryPlay(movie).choice)

        StubProtocol.reset { _ in .fixture("sources_discovered") }
        let options = await TitleActions(client: client()).play(movie)
        XCTAssertEqual(options.choice, PlayChoice(label: "Play", target: .movie(.tmdb(.movie, 10378)), candidateId: "file:1", subtitle: "2008"))
        XCTAssertEqual(options.sources.count, 3)
        XCTAssertTrue(options.lookedFurther)
        XCTAssertEqual(paths, ["/api/sources?mediaType=movie&tmdbId=10378&discover=1"])
    }

    func testNothingToPlayWhenTheServerFindsNothing() async throws {
        let movie = try fixture(MovieDetail.self, "movie_full", ["available": []])
        StubProtocol.reset { _ in .json(200, ["items": []]) }
        let options = await TitleActions(client: client()).play(movie)
        XCTAssertNil(options.choice)
        XCTAssertTrue(options.asked)

        StubProtocol.reset { _ in .fixture("error_404", status: 404) }
        let failed = await TitleActions(client: client()).play(movie)
        XCTAssertNil(failed.choice, "a failed lookup offers nothing")
    }

    func testShowResumesUpNextFromLibrary() async throws {
        let show = try fixture(ShowDetail.self, "show_full", ["upNext": ["season": 1, "episode": 2, "positionMs": 60_000, "available": true]])
        let expected = PlayChoice(label: "Resume S1 · E2", target: .episode(show: .tmdb(.show, 9001), season: 1, episode: 2), subtitle: "S1 · E2")
        XCTAssertEqual(TitleActions.libraryPlay(show).choice, expected)

        StubProtocol.reset { _ in .fixture("sources") }
        let options = await TitleActions(client: client()).play(show)
        XCTAssertEqual(options.choice, expected)
        XCTAssertFalse(options.lookedFurther)
        XCTAssertEqual(paths, ["/api/sources?mediaType=episode&tmdbId=9001&season=1&episode=2"])
    }

    func testShowUpNextNotInLibraryPlaysDiscoveredSource() async throws {
        // Older servers don't say whether Up Next is in the library: treated as not.
        let show = try fixture(ShowDetail.self, "show_full", ["upNext": ["season": 2, "episode": 3, "positionMs": 0]])
        XCTAssertNil(TitleActions.libraryPlay(show).choice)

        StubProtocol.reset { _ in .fixture("sources_discovered") }
        let options = await TitleActions(client: client()).play(show)
        XCTAssertEqual(options.choice, PlayChoice(label: "Play S2 · E3", target: .episode(show: .tmdb(.show, 9001), season: 2, episode: 3), candidateId: "file:1", subtitle: "S2 · E3"))
        XCTAssertTrue(options.lookedFurther)
        XCTAssertEqual(paths, ["/api/sources?mediaType=episode&tmdbId=9001&season=2&episode=3&discover=1"])
    }

    func testShowWithoutUpNextHasNoPlay() async throws {
        let show = try Fixture.decode(ShowDetail.self, "show_full")
        StubProtocol.reset { _ in .fixture("sources") }
        let options = await TitleActions(client: client()).play(show)
        XCTAssertNil(options.choice)
        XCTAssertTrue(StubProtocol.recorded.isEmpty)
    }

    func testCardsAnswerAsTheirPagesWould() async throws {
        // A movie in the library plays straight away, without asking.
        let movie = TitleCard(type: .movie, tmdbId: 10378, title: "Big Buck Bunny", year: 2008, available: [.local])
        XCTAssertEqual(TitleActions.libraryPlay(movie).choice, PlayChoice(label: "Play", target: .movie(.tmdb(.movie, 10378)), subtitle: "2008"))

        // A show's Up Next comes from its page; in the library, no sources are asked for.
        var show = try XCTUnwrap(JSONSerialization.jsonObject(with: Fixture.data("show_full")) as? [String: Any])
        show["upNext"] = ["season": 1, "episode": 1, "positionMs": 0, "available": true]
        let body = try JSONSerialization.data(withJSONObject: show)
        StubProtocol.reset { _ in StubProtocol.Reply(status: 200, body: body) }
        let card = TitleCard(type: .show, tmdbId: 9001, title: "Test Show")
        XCTAssertNil(TitleActions.libraryPlay(card).choice)
        let options = await TitleActions(client: client()).play(card)
        XCTAssertEqual(options.choice, PlayChoice(label: "Play S1 · E1", target: .episode(show: .tmdb(.show, 9001), season: 1, episode: 1), subtitle: "S1 · E1"))
        XCTAssertEqual(paths, ["/api/titles/tmdb:show:9001"])
    }

    func testEpisodeRow() async throws {
        let season = try Fixture.decode(SeasonDetail.self, "season")
        var episode = try XCTUnwrap(season.episodes.first)
        let actions = TitleActions(client: client())

        episode.available = [.local]
        StubProtocol.reset { _ in .fixture("sources") }
        let fromLibrary = await actions.play(episode, of: .tmdb(.show, 9001))
        XCTAssertNil(fromLibrary?.candidateId)
        XCTAssertEqual(fromLibrary?.subtitle, "\(episode.code) · \(episode.name)")
        XCTAssertTrue(StubProtocol.recorded.isEmpty)

        episode.available = []
        StubProtocol.reset { _ in .json(200, ["items": []]) }
        let missing = await actions.play(episode, of: .tmdb(.show, 9001))
        XCTAssertNil(missing, "nothing found: it isn't in the library")
    }

    // MARK: - Changes

    func testChangesSignalOnceAndClearTheCache() async throws {
        StubProtocol.reset { req in req.url?.path == "/api/home" ? .fixture("home") : .json(200, ["ok": true]) }
        let c = client(ttl: 60)
        let actions = TitleActions(client: c)
        var changes = actions.changes.makeAsyncIterator()

        _ = try await c.home()
        try await actions.setOnList(.tmdb(.movie, 10378), true)
        _ = try await c.home()
        let list = await changes.next()
        XCTAssertEqual(list, .list(.tmdb(.movie, 10378), on: true))
        XCTAssertEqual(list?.changesCalendar, true)

        try await actions.setWatched(.episode(show: .tmdb(.show, 9001), season: 1, episode: 2), true)
        let watched = await changes.next()
        XCTAssertEqual(watched, .watched(.episode(show: .tmdb(.show, 9001), season: 1, episode: 2), true))
        XCTAssertEqual(watched?.changesCalendar, false)

        try await actions.hideFromContinue(.tmdb(.show, 9001))
        let hidden = await changes.next()
        XCTAssertEqual(hidden, .hiddenFromContinue(.tmdb(.show, 9001)))

        _ = try await c.home()
        await actions.progressSaved(.episode(show: .tmdb(.show, 9001), season: 1, episode: 2))
        _ = try await c.home()
        let progress = await changes.next()
        XCTAssertEqual(progress, .progress)

        XCTAssertEqual(StubProtocol.recorded.map { "\($0.httpMethod!) \($0.url!.path)" }, [
            "GET /api/home", "PUT /api/watchlist", "GET /api/home",
            "POST /api/watched", "DELETE /api/continue/show/9001",
            "GET /api/home", "GET /api/home",
        ], "Home is fetched again after every change")
    }

    func testFailedChangeThrowsAndSignalsNothing() async throws {
        StubProtocol.reset { req in req.url?.path == "/api/watchlist" ? .fixture("error_404", status: 404) : .json(200, ["ok": true]) }
        let actions = TitleActions(client: client())
        var changes = actions.changes.makeAsyncIterator()
        do {
            try await actions.setOnList(.tmdb(.show, 9001), true)
            XCTFail("expected a failure")
        } catch {}
        try await actions.setWatched(.movie(.tmdb(.movie, 10378)), false)
        let next = await changes.next()
        XCTAssertEqual(next, .watched(.movie(.tmdb(.movie, 10378)), false), "the failed change sent nothing")
    }

    func testRetriesOnceAfterRecovering() async throws {
        let down = StrataClient(baseURL: URL(string: "http://down.test:8420")!, token: "tok", session: StubProtocol.session(), cacheTTL: 0)
        let up = client()
        let current = Box(down)
        StubProtocol.reset { req in
            if req.url?.host == "down.test" { throw URLError(.cannotConnectToHost) }
            return .json(200, ["ok": true])
        }
        let actions = TitleActions(client: { current.value }, recover: { error in
            guard StrataError.wrap(error).isConnectivity else { return false }
            current.value = up
            return true
        })
        try await actions.hideFromContinue(.tmdb(.movie, 10378))
        XCTAssertEqual(StubProtocol.recorded.map { $0.url!.host! }, ["down.test", "strata.test"])
    }

    func testNotConnected() async {
        let actions = TitleActions(client: { nil })
        do {
            try await actions.setWatched(.movie(.tmdb(.movie, 1)), true)
            XCTFail("expected a failure")
        } catch {}
        let options = await actions.play(TitleCard(type: .movie, tmdbId: 1, title: "X"))
        XCTAssertNil(options.choice)
    }
}

private final class Box: @unchecked Sendable {
    private let lock = NSLock()
    private var _value: StrataClient
    init(_ value: StrataClient) { _value = value }
    var value: StrataClient {
        get { lock.lock(); defer { lock.unlock() }; return _value }
        set { lock.lock(); defer { lock.unlock() }; _value = newValue }
    }
}

final class TokenStorageTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suite = "strata.tests.tokens"

    override func setUp() {
        defaults = UserDefaults(suiteName: suite)
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
    }

    /// A Keychain that holds items, or refuses every write.
    private final class FakeKeychain: @unchecked Sendable {
        var items: [String: String] = [:]
        var refuses = false
        func set(_ value: String?, _ key: String) -> OSStatus {
            if refuses { return errSecNotAvailable }
            items[key] = value
            return value == nil ? errSecParam : errSecSuccess
        }
    }

    private func storage(_ keychain: FakeKeychain) -> TokenStorage {
        .keychain(defaults: defaults, set: { keychain.set($0, $1) }, get: { keychain.items[$0] })
    }

    func testKeychainFailureKeepsTheTokenInMemoryOnly() {
        let keychain = FakeKeychain()
        keychain.refuses = true
        let tokens = storage(keychain)
        tokens.write("secret", "a")
        XCTAssertEqual(tokens.read("a"), "secret", "signed in for this run")
        XCTAssertNil(defaults.string(forKey: "strata.token.fallback.a"), "never in plaintext")
        XCTAssertTrue(keychain.items.isEmpty)
        XCTAssertNil(storage(keychain).read("a"), "gone next launch")

        tokens.write(nil, "a")
        XCTAssertNil(tokens.read("a"))
    }

    func testWritesGoToTheKeychain() {
        let keychain = FakeKeychain()
        let tokens = storage(keychain)
        tokens.write("secret", "a")
        XCTAssertEqual(keychain.items["strata.token.a"], "secret")
        XCTAssertEqual(storage(keychain).read("a"), "secret")
        tokens.write(nil, "a")
        XCTAssertNil(tokens.read("a"))
    }

    func testPlaintextTokenMovesToTheKeychain() {
        defaults.set("old", forKey: "strata.token.fallback.a")
        let keychain = FakeKeychain()
        XCTAssertEqual(storage(keychain).read("a"), "old")
        XCTAssertEqual(keychain.items["strata.token.a"], "old")
        XCTAssertNil(defaults.string(forKey: "strata.token.fallback.a"))
    }

    func testPlaintextTokenLeavesUserDefaultsEvenWhenTheKeychainFails() {
        defaults.set("old", forKey: "strata.token.fallback.a")
        let keychain = FakeKeychain()
        keychain.refuses = true
        let tokens = storage(keychain)
        XCTAssertEqual(tokens.read("a"), "old", "still signed in for this run")
        XCTAssertNil(defaults.string(forKey: "strata.token.fallback.a"))
        XCTAssertEqual(tokens.read("a"), "old")
    }
}
