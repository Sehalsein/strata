import XCTest
@testable import StrataKit

/// Decodes JSON captured from the real server (`apps/server`, fake TMDB + ffmpeg fixtures)
/// plus a few hand-written payloads for paths that need TMDB.
final class ModelDecodingTests: XCTestCase {
    func testServerInfo() throws {
        let info = try Fixture.decode(ServerInfo.self, "info")
        XCTAssertEqual(info.name, "strata")
        XCTAssertEqual(info.serverName, "Strata")
        XCTAssertEqual(info.apiVersion, 1)
        XCTAssertTrue(info.setupRequired)
        XCTAssertTrue(info.isStrata)
        XCTAssertTrue(info.isCompatible)
        XCTAssertFalse(info.id.isEmpty)
    }

    func testTokenMeProfiles() throws {
        XCTAssertFalse(try Fixture.decode(TokenResponse.self, "login").token.isEmpty)
        XCTAssertFalse(try Fixture.decode(TokenResponse.self, "setup").token.isEmpty)
        let me = try Fixture.decode(Me.self, "me")
        XCTAssertEqual(me.user.username, "sehal")
        XCTAssertTrue(me.user.isAdmin)
        XCTAssertEqual(me.profile?.id, 1)
        XCTAssertNil(me.profile?.avatar)
        let profiles = try Fixture.decode([Profile].self, "profiles")
        XCTAssertEqual(profiles.map(\.name), ["sehal", "Kids"])
        XCTAssertEqual(profiles.map(\.hasPin), [false, true])
        XCTAssertEqual(profiles[1].initial, "K")
    }

    func testHome() throws {
        let home = try Fixture.decode(ShelvesResponse.self, "home").shelves
        XCTAssertEqual(home.first?.id, "continue")
        XCTAssertEqual(home.first?.kind, .continue)
        let card = try XCTUnwrap(home.first?.items.first)
        XCTAssertEqual(card.type, .show)
        XCTAssertEqual(card.episode?.name, "Pilot")
        XCTAssertEqual(card.episode?.code, "S1 · E1")
        XCTAssertEqual(card.positionMs, 120_000)
        XCTAssertEqual(card.progressFraction ?? 0, 0.08, accuracy: 0.0001)
        XCTAssertEqual(card.playbackTarget, .episode(show: 9001, season: 1, episode: 1))
        XCTAssertEqual(card.id, "show-9001-s1e1")
        let titles = try XCTUnwrap(home.first { $0.id == "watchlist" })
        XCTAssertEqual(titles.kind, .titles)
        let movie = try XCTUnwrap(titles.items.first)
        XCTAssertEqual(movie.id, "movie-10378")
        XCTAssertEqual(movie.posterUrl?.absoluteString, "https://image.tmdb.org/t/p/w342/bbb.jpg")
        XCTAssertNil(movie.backdropUrl)
        XCTAssertNil(movie.progressFraction)
        XCTAssertTrue(movie.isAvailable)
        XCTAssertEqual(movie.availabilityLabel, "Library")
        XCTAssertEqual(movie.playbackTarget, .movie(10378))
        XCTAssertEqual(Set(home.map(\.id)), ["continue", "watchlist", "libraryMovies", "libraryShows", "trendingMovies", "trendingShows"])
    }

    func testShelfStylesAndBadges() throws {
        let json = Data(#"""
        [{"id":"a","title":"Trending","kind":"titles","style":"hero","items":[{"type":"show","tmdbId":1,"title":"X","year":null,"posterUrl":null,"backdropUrl":null,"available":[],"badge":"Episode 4"}]},
         {"id":"b","title":"Later","kind":"titles","style":"carousel3d","items":[]},
         {"id":"c","title":"Plain","kind":"titles","items":[]}]
        """#.utf8)
        let shelves = try JSONDecoder().decode([Shelf].self, from: json)
        XCTAssertEqual(shelves.map(\.style), [.hero, nil, nil]) // an unknown style is a rail
        XCTAssertEqual(shelves[0].items[0].badge, "Episode 4")
    }

    func testCalendarEpisodes() throws {
        let json = Data(#"""
        {"items":[{"tmdbId":1,"title":"Frieren","posterUrl":null,"backdropUrl":null,"season":null,"episode":32,"name":null,"airsAt":"2026-11-07T15:00:00.000Z","airDate":"2026-11-07","available":false},
                  {"tmdbId":2,"title":"The Drama","posterUrl":null,"backdropUrl":null,"season":2,"episode":3,"name":"Three","airsAt":null,"airDate":"2026-11-03","available":true}]}
        """#.utf8)
        let items = try JSONDecoder().decode(ItemsResponse<CalendarEpisode>.self, from: json).items
        XCTAssertEqual(items[0].date, Date(timeIntervalSince1970: 1_794_063_600))
        XCTAssertTrue(items[0].hasTime)
        XCTAssertEqual(items[0].code, "Episode 32")
        XCTAssertFalse(items[1].hasTime)
        XCTAssertEqual(items[1].code, "S2 · E3")
        XCTAssertEqual(Calendar.current.dateComponents([.year, .month, .day, .hour], from: items[1].date), DateComponents(year: 2026, month: 11, day: 3, hour: 0))
    }

    func testBrowseAndSearch() throws {
        let browse = try Fixture.decode(ItemsResponse<TitleCard>.self, "browse").items
        XCTAssertEqual(browse.first?.yearText, "2008")
        let search = try Fixture.decode(ItemsResponse<TitleCard>.self, "search").items
        XCTAssertEqual(search.count, 2)
        // Any storage other than the server's own disks decodes as `.linked`; both are "Library".
        XCTAssertEqual(search[0].available, [.local, .linked])
        XCTAssertEqual(search[0].availabilityLabel, "Library")
        XCTAssertEqual(search[0].ratingText, "6.4")
        XCTAssertNil(search[1].year)
        XCTAssertNil(search[1].ratingText)
        XCTAssertFalse(search[1].isAvailable)
        XCTAssertNil(search[1].playbackTarget)
        XCTAssertNotEqual(search[0].id, search[1].id, "movie and show with the same TMDB id stay distinct")
    }

    func testMovie() throws {
        let m = try Fixture.decode(MovieDetail.self, "movie")
        XCTAssertEqual(m.title, "Big Buck Bunny")
        XCTAssertEqual(m.imdbId, "tt1254207")
        XCTAssertEqual(m.runtimeText, "10m")
        XCTAssertEqual(m.genres, ["Animation"])
        XCTAssertEqual(m.sources.first?.provider, .local)
        XCTAssertEqual(m.progress?.completed, true)
        XCTAssertNil(m.resumeMs)
        XCTAssertTrue(m.inWatchlist)
        XCTAssertEqual(m.target, .movie(10378))

        let full = try Fixture.decode(MovieDetail.self, "movie_full")
        XCTAssertEqual(full.cast.count, 2)
        XCTAssertNil(full.cast[1].character)
        XCTAssertEqual(full.trailer?.youtubeURL?.absoluteString, "https://www.youtube.com/watch?v=aqz-KE-bpKQ")
        XCTAssertEqual(full.collection?.name, "Blender Open Movies")
        XCTAssertEqual(full.recommendations.first?.title, "Sintel")
        XCTAssertEqual(full.resumeMs, 600_000)
        XCTAssertEqual(full.certification, "PG")
        XCTAssertNotNil(full.releaseDateValue)
    }

    func testShow() throws {
        let s = try Fixture.decode(ShowDetail.self, "show")
        XCTAssertEqual(s.seasons.first?.availableEpisodes, 2)
        XCTAssertEqual(s.upNext, UpNext(season: 1, episode: 1, positionMs: 120_000))
        XCTAssertEqual(s.upNext?.isResume, true)
        XCTAssertEqual(s.upNextTarget, .episode(show: 9001, season: 1, episode: 1))
        XCTAssertEqual(s.yearRangeText, "2020")

        let full = try Fixture.decode(ShowDetail.self, "show_full")
        XCTAssertNil(full.upNext)
        XCTAssertEqual(full.orderedSeasons.map(\.season), [1, 0])
        XCTAssertEqual(full.yearRangeText, "2020–2023")
    }

    func testSeason() throws {
        let season = try Fixture.decode(SeasonDetail.self, "season")
        XCTAssertEqual(season.episodes.count, 2)
        let e1 = season.episodes[0]
        XCTAssertEqual(e1.code, "S1 · E1")
        XCTAssertEqual(e1.available, [.local])
        XCTAssertFalse(e1.isWatched)
        XCTAssertEqual(e1.progressFraction ?? 0, 0.08, accuracy: 0.0001)
        XCTAssertNil(season.episodes[1].progress)
        XCTAssertFalse(season.episodes[1].isUpcoming)
        XCTAssertEqual(e1.target(show: 9001), .episode(show: 9001, season: 1, episode: 1))
    }

    func testCandidates() throws {
        let library = try Fixture.decode(ItemsResponse<Candidate>.self, "sources").items
        XCTAssertEqual(library.first?.id, "file:1")
        XCTAssertEqual(library.first?.specLabels.prefix(3), ["1080p", "H.264", "Blu-ray"])
        // Older servers send no labels: the file name stands in and it reads as ready.
        XCTAssertEqual(library.first?.readiness, .ready)

        // The server's labels are shown as they are.
        let all = try Fixture.decode(ItemsResponse<Candidate>.self, "sources_discovered").items
        XCTAssertEqual(all.map(\.readiness), [.ready, .instant, .download])
        XCTAssertEqual(all.map(\.originLabel), ["Library", "Cloud", "Cloud"])
        XCTAssertEqual(all[1].displayName, "Big.Buck.Bunny.2008.2160p.UHD.BluRay.REMUX.DV.HEVC-GRP")
        XCTAssertEqual(all[1].detail, "45.0 GB · Remux")
        XCTAssertEqual(all[1].provider, .linked)
        XCTAssertEqual(all[1].hdrLabel, "Dolby Vision")
        XCTAssertNil(all[2].detail)
    }

    func testPlayDirect() throws {
        let p = try Fixture.decode(PlayResponse.self, "play_direct")
        XCTAssertEqual(p.mode, .direct)
        XCTAssertFalse(p.mode.isHLS)
        XCTAssertEqual(p.url.relativeString, "/api/stream/0cc026ea414e93ae34913ef5c3049cfd/file")
        XCTAssertEqual(p.seekToMs, 5000)
        XCTAssertEqual(p.startOffsetMs, 0)
        XCTAssertEqual(p.candidate.audio?.first?.channelLayout, "Mono")
        XCTAssertEqual(p.nextEpisode?.name, "Second")
        XCTAssertEqual(p.nextEpisode?.available, true)
        XCTAssertEqual(p.selectedAudio?.index, 1)
    }

    func testPlayRemuxSubtitles() throws {
        let p = try Fixture.decode(PlayResponse.self, "play_remux")
        XCTAssertEqual(p.mode, .remux)
        XCTAssertEqual(p.startOffsetMs, 12_000)
        XCTAssertEqual(p.subtitleTracks.map(\.id), ["s2", "x0"])
        XCTAssertEqual(p.subtitleTracks[1].forced, true)
        XCTAssertTrue(p.subtitleTracks[1].external)
        XCTAssertTrue(p.subtitleTracks[0].isTextBased)
        XCTAssertNil(p.subtitleTracks[0].title)
        XCTAssertNil(p.nextEpisode)
        XCTAssertEqual(p.reasons, ["container mkv → HLS"])
    }

    func testPlayTranscodeTracksAndChapters() throws {
        let p = try Fixture.decode(PlayResponse.self, "play_transcode")
        XCTAssertEqual(p.mode, .transcode)
        XCTAssertEqual(p.audioTracks.count, 3)
        XCTAssertEqual(p.selectedAudio?.index, 2)
        XCTAssertTrue(p.audioTracks[0].displayTitle.hasPrefix("TrueHD Atmos 7.1"))
        XCTAssertTrue(p.audioTracks[1].displayTitle.contains("5.1"))
        let pgs = try XCTUnwrap(p.subtitleTracks.last)
        XCTAssertNil(pgs.url)
        XCTAssertFalse(pgs.isTextBased)
        XCTAssertEqual(p.chapters.map(\.start), [0, 600, 1800])
        XCTAssertNil(p.chapters[1].title)
        XCTAssertEqual(p.nextEpisode?.available, false)
    }

    func testProgress() throws {
        let progress = try Fixture.decode(WatchProgress.self, "progress")
        XCTAssertEqual(progress.positionMs, 13_000)
        XCTAssertTrue(progress.completed)
    }

    func testTargetEncodingOmitsNil() throws {
        let data = try JSONEncoder().encode(PlaybackTarget.movie(5))
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj["mediaType"] as? String, "movie")
        XCTAssertNil(obj["season"])
    }

    func testFormatting() {
        XCTAssertEqual(Formatting.runtime(minutes: 102), "1h 42m")
        XCTAssertEqual(Formatting.runtime(minutes: 120), "2h")
        XCTAssertNil(Formatting.runtime(minutes: 0))
        XCTAssertEqual(Formatting.runtime(ms: 2_700_000), "45m")
        XCTAssertEqual(LanguageName.normalized("eng"), "en")
        XCTAssertEqual(LanguageName.normalized("en-US"), "en")
        XCTAssertNil(LanguageName.display("und"))
    }
}
