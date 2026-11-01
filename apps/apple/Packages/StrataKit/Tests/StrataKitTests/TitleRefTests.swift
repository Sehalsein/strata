import XCTest
@testable import StrataKit

final class TitleRefTests: XCTestCase {
    func testParseAndFormat() throws {
        let ref = try XCTUnwrap(TitleRef(string: "anilist:show:154587"))
        XCTAssertEqual(ref.source, .anilist)
        XCTAssertEqual(ref.type, .show)
        XCTAssertEqual(ref.id, 154_587)
        XCTAssertNil(ref.tmdbId)
        XCTAssertEqual(ref.description, "anilist:show:154587")
        XCTAssertEqual(TitleRef(string: "tmdb:movie:603"), .tmdb(.movie, 603))
        XCTAssertEqual(TitleRef.tmdb(.show, 1399).tmdbId, 1399)
        XCTAssertEqual(TitleRef(string: "tmdb:movie:2147483647")?.id, 2_147_483_647)
        for bad in ["", "tmdb:tv:1", "tmdb:episode:1", "tmdb:movie:0", "tmdb:movie:-1", "tmdb:movie:01", "tmdb:movie:1.5",
                    "tmdb:movie:2147483648", "tmdb:movie:1:extra", "tmdb:movie", " tmdb:movie:1", "TMDB:movie:1", ":movie:1"] {
            XCTAssertNil(TitleRef(string: bad), bad)
        }
    }

    func testUnknownSourceIsKeptButUnsupported() throws {
        let ref = try XCTUnwrap(TitleRef(string: "imdb:movie:1"))
        XCTAssertEqual(ref.source.rawValue, "imdb")
        XCTAssertFalse(ref.isSupported)
        XCTAssertTrue(TitleRef.tmdb(.movie, 1).isSupported)
        XCTAssertTrue(TitleRef(source: .anilist, type: .movie, id: 1).isSupported)
    }

    func testCodableAsOneString() throws {
        let ref = TitleRef(source: .anilist, type: .movie, id: 21519)
        let data = try JSONEncoder().encode([ref])
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"["anilist:movie:21519"]"#)
        XCTAssertEqual(try JSONDecoder().decode([TitleRef].self, from: data), [ref])
        XCTAssertThrowsError(try JSONDecoder().decode([TitleRef].self, from: Data(#"["tmdb:tv:1"]"#.utf8)))
    }

    // MARK: - Cards

    private func cards(_ json: String) throws -> [TitleCard] {
        try JSONDecoder().decode(ItemsResponse<TitleCard>.self, from: Data(json.utf8)).items
    }

    func testCardWithRefAndNoTmdbId() throws {
        let items = try cards(#"{"items":[{"ref":"anilist:show:154587","type":"show","title":"Frieren","available":[]}]}"#)
        let card = try XCTUnwrap(items.first)
        XCTAssertEqual(card.ref, TitleRef(source: .anilist, type: .show, id: 154_587))
        XCTAssertNil(card.tmdbId)
        XCTAssertEqual(card.id, "anilist:show:154587")
        XCTAssertEqual(card.playbackTarget, nil, "a show card without an episode opens its page")
    }

    func testCardFromAnOlderServerIsTMDBs() throws {
        let card = try XCTUnwrap(try cards(#"{"items":[{"type":"movie","tmdbId":603,"title":"The Matrix","available":[]}]}"#).first)
        XCTAssertEqual(card.ref, .tmdb(.movie, 603))
        XCTAssertEqual(card.tmdbId, 603)
        XCTAssertEqual(card.playbackTarget, .movie(.tmdb(.movie, 603)))
    }

    func testContinueCardIdKeepsTheEpisode() throws {
        let json = #"{"items":[{"ref":"anilist:show:5","type":"show","title":"X","available":[],"episode":{"season":1,"episode":3,"name":"Three"}}]}"#
        let card = try XCTUnwrap(try cards(json).first)
        XCTAssertEqual(card.id, "anilist:show:5-s1e3")
        XCTAssertEqual(card.playbackTarget, .episode(show: TitleRef(source: .anilist, type: .show, id: 5), season: 1, episode: 3))
    }

    func testListsDropTitlesThisAppCantUse() throws {
        let json = """
        {"items":[
          {"ref":"imdb:movie:1","type":"movie","title":"Unknown source","available":[]},
          {"ref":"tmdb:tv:1","type":"show","title":"Bad ref","available":[]},
          {"type":"show","title":"No id at all","available":[]},
          {"title":"Not a card"},
          "nonsense",
          {"ref":"tmdb:movie:603","tmdbId":603,"type":"movie","title":"Kept","available":[]},
          {"ref":"anilist:movie:21519","type":"movie","title":"Also kept","available":[]}
        ]}
        """
        XCTAssertEqual(try cards(json).map(\.title), ["Kept", "Also kept"])

        let shelves = try JSONDecoder().decode(ShelvesResponse.self, from: Data("""
        {"shelves":[{"id":"a","title":"A","kind":"titles","items":[
          {"ref":"imdb:movie:1","type":"movie","title":"Gone","available":[]},
          {"ref":"anilist:show:2","type":"show","title":"Here","available":[]}]}]}
        """.utf8)).shelves
        XCTAssertEqual(shelves.first?.items.map(\.title), ["Here"])
    }

    func testCalendarByRef() throws {
        let json = """
        {"items":[
          {"ref":"anilist:show:154587","title":"Frieren","season":null,"episode":32,"airDate":"2026-11-07","available":false},
          {"tmdbId":2,"title":"Older server","season":2,"episode":3,"airDate":"2026-11-03","available":true},
          {"ref":"imdb:show:3","title":"Unknown","episode":1,"airDate":"2026-11-03","available":true}
        ]}
        """
        let items = try JSONDecoder().decode(ItemsResponse<CalendarEpisode>.self, from: Data(json.utf8)).items
        XCTAssertEqual(items.map(\.ref), [TitleRef(source: .anilist, type: .show, id: 154_587), .tmdb(.show, 2)])
        XCTAssertNil(items[0].tmdbId)
        XCTAssertEqual(items[0].id, "anilist:show:154587-x-32-2026-11-07")
    }

    func testShowPageByRefWithOtherSeasons() throws {
        var show = try JSONSerialization.jsonObject(with: Fixture.data("show")) as! [String: Any]
        show["ref"] = "anilist:show:154587"
        show.removeValue(forKey: "tmdbId")
        show["related"] = [["ref": "anilist:show:182255", "type": "show", "title": "Season 2", "available": []],
                           ["ref": "imdb:show:1", "type": "show", "title": "Unknown", "available": []]]
        let detail = try JSONDecoder().decode(ShowDetail.self, from: JSONSerialization.data(withJSONObject: show))
        XCTAssertEqual(detail.ref, TitleRef(source: .anilist, type: .show, id: 154_587))
        XCTAssertNil(detail.tmdbId)
        XCTAssertEqual(detail.related.map(\.title), ["Season 2"])
        XCTAssertEqual(detail.upNextTarget?.title, detail.ref)

        let old = try Fixture.decode(ShowDetail.self, "show")
        XCTAssertEqual(old.ref, .tmdb(.show, 9001))
        XCTAssertEqual(old.related, [], "older servers send no related titles")
        XCTAssertEqual(try Fixture.decode(MovieDetail.self, "movie").target, .movie(.tmdb(.movie, 10378)))
    }

    // MARK: - Playback targets

    func testTargetKeptBeforeRefsReadsAsTMDBs() throws {
        let old = Data(#"{"mediaType":"episode","tmdbId":1399,"season":1,"episode":2}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(PlaybackTarget.self, from: old), .episode(show: .tmdb(.show, 1399), season: 1, episode: 2))
        let movie = Data(#"{"mediaType":"movie","tmdbId":603}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(PlaybackTarget.self, from: movie), .movie(.tmdb(.movie, 603)))
    }

    func testTargetRoundTrips() throws {
        for target in [PlaybackTarget.movie(.tmdb(.movie, 603)),
                       .episode(show: TitleRef(source: .anilist, type: .show, id: 154_587), season: 1, episode: 28)] {
            let data = try JSONEncoder().encode(target)
            XCTAssertEqual(try JSONDecoder().decode(PlaybackTarget.self, from: data), target)
        }
    }

    func testDownloadKeptBeforeRefsStillMatches() throws {
        // The id and the target as an older app kept them.
        let target = try JSONDecoder().decode(PlaybackTarget.self, from: Data(#"{"mediaType":"movie","tmdbId":42}"#.utf8))
        XCTAssertEqual(DownloadItem.id(signInID: "me", target: target), "me:movie:42::")
        XCTAssertEqual(DownloadItem.id(signInID: "me", target: .movie(.tmdb(.movie, 42))), "me:movie:42::")
        XCTAssertEqual(DownloadItem.id(signInID: "me", target: .episode(show: TitleRef(source: .anilist, type: .show, id: 7), season: 1, episode: 2)),
                       "me:episode:anilist:show:7:1:2")
    }

    func testQueueKeptBeforeRefsIsRead() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("queue-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let old = #"[{"signInID":"me","target":{"mediaType":"movie","tmdbId":42},"positionMs":1000,"durationMs":9000,"at":0}]"#
        try Data(old.utf8).write(to: url)
        let queue = ProgressQueue(url: url)
        let kept = await queue.isEmpty
        XCTAssertFalse(kept)
        StubProtocol.reset { _ in .fixture("progress") }
        await queue.flush(client: StrataClient(baseURL: URL(string: "http://strata.test:8420")!, token: "tok", session: StubProtocol.session(), cacheTTL: 0), signInID: "me")
        XCTAssertEqual(StubProtocol.recorded.first?.jsonBody?["tmdbId"] as? Int, 42)
        let sent = await queue.isEmpty
        XCTAssertTrue(sent)
    }
}

final class TitleRefClientTests: XCTestCase {
    private let base = URL(string: "http://strata.test:8420")!
    private let frieren = TitleRef(source: .anilist, type: .show, id: 154_587)
    private func client(ttl: TimeInterval = 0) -> StrataClient {
        StrataClient(baseURL: base, token: "tok", session: StubProtocol.session(), cacheTTL: ttl)
    }

    func testEveryRequestSaysItKnowsRefs() async throws {
        StubProtocol.reset { req in req.url?.path == "/api/home" ? .fixture("home") : .fixture("info") }
        _ = try await client().info()
        _ = try await client().home()
        XCTAssertEqual(StubProtocol.recorded.count, 2)
        for req in StubProtocol.recorded { XCTAssertEqual(req.value(forHTTPHeaderField: "X-Strata-Refs"), "1") }
    }

    func testTMDBTitlesSendTheFieldsEveryServerReads() async throws {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/progress": .fixture("progress")
            case "/api/play": .fixture("play_direct")
            default: .json(200, ["ok": true])
            }
        }
        let c = client()
        let episode = PlaybackTarget.episode(show: .tmdb(.show, 9001), season: 1, episode: 2)
        _ = try await c.play(episode)
        try await c.reportProgress(episode, positionMs: 1, durationMs: 2)
        try await c.setWatched(episode, true)
        try await c.setWatchlist(.tmdb(.show, 9001), true)
        try await c.hideFromContinue(.tmdb(.show, 9001))
        let reqs = StubProtocol.recorded
        for body in reqs.prefix(3).map(\.jsonBody) {
            XCTAssertEqual(body?["mediaType"] as? String, "episode")
            XCTAssertEqual(body?["tmdbId"] as? Int, 9001)
            XCTAssertEqual(body?["season"] as? Int, 1)
            XCTAssertEqual(body?["episode"] as? Int, 2)
            XCTAssertNil(body?["ref"])
        }
        XCTAssertEqual(reqs[3].jsonBody?["type"] as? String, "show")
        XCTAssertEqual(reqs[3].jsonBody?["tmdbId"] as? Int, 9001)
        XCTAssertNil(reqs[3].jsonBody?["ref"])
        XCTAssertEqual(reqs[4].url?.path, "/api/continue/show/9001")
    }

    func testOtherSourcesSendTheirRef() async throws {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/progress": .fixture("progress")
            case "/api/play": .fixture("play_direct")
            case "/api/sources": .fixture("sources")
            default: .json(200, ["ok": true])
            }
        }
        let c = client()
        let episode = PlaybackTarget.episode(show: frieren, season: 1, episode: 2)
        _ = try await c.play(episode, candidateId: "file:1")
        try await c.reportProgress(episode, positionMs: 1, durationMs: 2, sessionId: "s")
        try await c.setWatched(episode, false)
        try await c.setWatchlist(frieren, true)
        try await c.hideFromContinue(frieren)
        _ = try await c.sources(episode)
        let reqs = StubProtocol.recorded
        for body in reqs.prefix(3).map(\.jsonBody) {
            XCTAssertEqual(body?["ref"] as? String, "anilist:show:154587")
            XCTAssertEqual(body?["season"] as? Int, 1)
            XCTAssertEqual(body?["episode"] as? Int, 2)
            XCTAssertNil(body?["tmdbId"])
            XCTAssertNil(body?["mediaType"])
        }
        XCTAssertEqual(reqs[0].jsonBody?["candidateId"] as? String, "file:1")
        XCTAssertEqual(reqs[1].jsonBody?["sessionId"] as? String, "s")
        XCTAssertEqual(reqs[2].jsonBody?["watched"] as? Bool, false)
        XCTAssertEqual(reqs[3].jsonBody?.keys.sorted(), ["on", "ref"])
        XCTAssertEqual(reqs[3].jsonBody?["ref"] as? String, "anilist:show:154587")
        XCTAssertEqual(reqs[4].httpMethod, "DELETE")
        XCTAssertEqual(reqs[4].url?.path, "/api/continue/anilist:show:154587")
        XCTAssertEqual(reqs[5].url?.query, "ref=anilist:show:154587&season=1&episode=2")
    }

    func testTitlePagesByRefFallBackToTheOldRoutes() async throws {
        // A server from before refs: only the old routes.
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/titles/show/9001": .fixture("show")
            case "/api/titles/show/9001/seasons/1": .fixture("season")
            default: .fixture("error_404", status: 404)
            }
        }
        let c = client()
        let show = try await c.show(.tmdb(.show, 9001))
        XCTAssertEqual(show.ref, .tmdb(.show, 9001))
        _ = try await c.season(show: .tmdb(.show, 9001), 1)
        XCTAssertEqual(StubProtocol.recorded.map(\.url!.path), [
            "/api/titles/tmdb:show:9001", "/api/titles/show/9001",
            "/api/titles/tmdb:show:9001/seasons/1", "/api/titles/show/9001/seasons/1",
        ])

        // Nothing to fall back to for other sources.
        StubProtocol.reset { _ in .fixture("error_404", status: 404) }
        do { _ = try await c.show(frieren); XCTFail("expected 404") } catch let e as StrataError { XCTAssertTrue(e.isNotFound) }
        XCTAssertEqual(StubProtocol.recorded.map(\.url!.path), ["/api/titles/anilist:show:154587"])
    }

    func testChangesDropTheTitleWhereverItWasKept() async throws {
        StubProtocol.reset { req in
            switch req.url?.path {
            case "/api/progress": .fixture("progress")
            case "/api/titles/tmdb:show:9001": .fixture("error_404", status: 404)
            default: .fixture("show")
            }
        }
        let c = client(ttl: 60)
        _ = try await c.show(.tmdb(.show, 9001)) // kept under the old route
        _ = try await c.show(frieren)
        try await c.reportProgress(.episode(show: .tmdb(.show, 9001), season: 1, episode: 1), positionMs: 1, durationMs: 2)
        try await c.reportProgress(.episode(show: frieren, season: 1, episode: 1), positionMs: 1, durationMs: 2)
        _ = try await c.show(.tmdb(.show, 9001))
        _ = try await c.show(frieren)
        XCTAssertEqual(StubProtocol.recorded.map(\.url!.path).suffix(3), [
            "/api/titles/tmdb:show:9001", "/api/titles/show/9001", "/api/titles/anilist:show:154587",
        ])
    }
}
