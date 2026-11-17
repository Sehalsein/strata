import Foundation
import XCTest
@testable import StrataKit

/// The Apple TV's Top Shelf: Continue Watching and Up Next as Home last loaded them, and
/// which of them a link may start playing.
final class TopShelfTests: XCTestCase {
    private let still = URL(string: "https://img.test/still.jpg")!
    private let backdrop = URL(string: "https://img.test/backdrop.jpg")!

    private var shelves: [Shelf] {
        let movie = TitleCard(ref: .tmdb(.movie, 603), title: "The Matrix", year: 1999, backdropUrl: backdrop, positionMs: 30 * 60_000, durationMs: 120 * 60_000)
        let episode = TitleCard(ref: .tmdb(.show, 9001), title: "Test Show", backdropUrl: backdrop,
                                episode: EpisodeRef(season: 2, episode: 4, name: "Pilot II", stillUrl: still))
        let other = TitleCard(ref: .tmdb(.movie, 1), title: "Trending")
        return [
            Shelf(id: "featured", title: "Featured", kind: .titles, items: [other]),
            Shelf(id: "continue", title: "Continue Watching", kind: .continue, items: [movie]),
            Shelf(id: "nextUp", title: "Up Next", kind: .continue, items: [episode, movie]),
            Shelf(id: "trendingMovies", title: "Trending", kind: .titles, items: [other]),
        ]
    }

    func testItemsAreContinueWatchingThenUpNext() {
        let items = TopShelf.items(from: shelves)
        XCTAssertEqual(items.map(\.title), ["The Matrix", "Test Show"], "only those rows, each title once")
        XCTAssertEqual(items[0].progress ?? 0, 0.25, accuracy: 0.001)
        XCTAssertEqual(items[0].imageURL, backdrop)
        XCTAssertEqual(items[1].imageURL, still, "an episode shows its still")
        XCTAssertEqual(items[1].subtitle?.hasSuffix("Pilot II"), true)
        XCTAssertNil(items[1].progress)
    }

    func testLinksOpenThePageOrPlay() {
        let items = TopShelf.items(from: shelves)
        XCTAssertEqual(items[0].displayURL?.absoluteString, "strata://title/tmdb:movie:603")
        XCTAssertEqual(items[0].playURL?.absoluteString, "strata://play/tmdb:movie:603")
        XCTAssertEqual(items[1].playURL?.absoluteString, "strata://play/tmdb:show:9001/2/4")
    }

    /// A link starts playback only for an item on the Top Shelf now: a link from a page or
    /// another app can't.
    func testOnlyTopShelfItemsPlayFromALink() throws {
        let snapshot = TopShelfSnapshot(signIn: "me", items: TopShelf.items(from: shelves))
        let play = try XCTUnwrap(URL(string: "strata://play/tmdb:show:9001/2/4"))
        XCTAssertEqual(TopShelf.playable(play, in: snapshot)?.title, "Test Show")
        XCTAssertNil(TopShelf.playable(URL(string: "strata://play/tmdb:show:9001/3/1")!, in: snapshot), "not on the shelf")
        XCTAssertNil(TopShelf.playable(URL(string: "strata://play/tmdb:movie:1")!, in: snapshot))
        XCTAssertNil(TopShelf.playable(play, in: nil))
        XCTAssertNil(TopShelf.playable(URL(string: "strata://title/tmdb:movie:603")!, in: snapshot))
    }

    /// With a logo, the title's own backdrop carries it (the app lays the logo on it);
    /// without one, an episode's still says which episode it is.
    func testWithALogoTheBackdropCarriesIt() throws {
        var show = TitleCard(ref: .tmdb(.show, 9001), title: "Test Show", backdropUrl: backdrop,
                             episode: EpisodeRef(season: 2, episode: 4, name: "Pilot II", stillUrl: still))
        show.logoUrl = URL(string: "https://img.test/logo.png")
        let item = try XCTUnwrap(TopShelf.items(from: [Shelf(id: "nextUp", title: "Up Next", kind: .continue, items: [show])]).first)
        XCTAssertEqual(item.imageURL, backdrop)
        XCTAssertEqual(item.logoURL, show.logoUrl)
        // The art's name follows its images: the same art keeps its file, new art gets a new one.
        let name = try XCTUnwrap(TopShelf.artworkName(for: item))
        XCTAssertEqual(TopShelf.artworkName(for: item), name)
        var moved = item
        moved.logoURL = URL(string: "https://img.test/other-logo.png")
        XCTAssertNotEqual(TopShelf.artworkName(for: moved), name)
        XCTAssertNil(TopShelf.artworkName(for: TopShelf.items(from: shelves)[0]), "no logo, no art to make")
        // Until the art is made, the Top Shelf shows the backdrop.
        XCTAssertEqual(TopShelf.image(for: item), backdrop)
    }

    func testAtMostTwelveItems() {
        let many = (1...30).map { TitleCard(ref: .tmdb(.movie, $0), title: "M\($0)", positionMs: 60_000, durationMs: 600_000) }
        XCTAssertEqual(TopShelf.items(from: [Shelf(id: "continue", title: "C", kind: .continue, items: many)]).count, TopShelf.limit)
    }
}
