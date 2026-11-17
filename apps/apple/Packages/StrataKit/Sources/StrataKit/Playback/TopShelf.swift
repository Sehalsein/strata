import Foundation

/// What the Apple TV's Top Shelf shows for Strata: the signed-in person's Continue Watching
/// and Up Next, as the app last loaded them. The app writes it to the App Group's container
/// whenever Home loads; the Top Shelf extension only reads it (it has no network or sign-in
/// of its own). It also says which titles the Top Shelf may start playing (`play(url:)`).
public struct TopShelfSnapshot: Codable, Sendable, Equatable {
    public struct Item: Codable, Sendable, Equatable, Identifiable {
        /// The title's ref ("tmdb:movie:603").
        public var ref: String
        public var title: String
        /// "S2 · E4 · Name" for an episode, else the year.
        public var subtitle: String?
        /// Landscape art: the episode's still or the title's backdrop.
        public var imageURL: URL?
        /// 0…1 watched, for the progress bar; nil for Up Next (not started).
        public var progress: Double?
        /// The episode to play, for a show.
        public var season: Int?
        public var episode: Int?

        public var id: String { [ref, season.map(String.init), episode.map(String.init)].compactMap { $0 }.joined(separator: "/") }

        public init(ref: String, title: String, subtitle: String? = nil, imageURL: URL? = nil, progress: Double? = nil, season: Int? = nil, episode: Int? = nil) {
            self.ref = ref
            self.title = title
            self.subtitle = subtitle
            self.imageURL = imageURL
            self.progress = progress
            self.season = season
            self.episode = episode
        }

        /// Opens the title's page.
        public var displayURL: URL? {
            var c = URLComponents()
            c.scheme = "strata"
            c.host = "title"
            c.path = "/" + ref
            return c.url
        }

        /// Plays it (the remote's Play button on the item): `strata://play/<ref>[/<season>/<episode>]`.
        public var playURL: URL? {
            var c = URLComponents()
            c.scheme = "strata"
            c.host = "play"
            c.path = "/" + ([ref] + [season, episode].compactMap { $0.map(String.init) }).joined(separator: "/")
            return c.url
        }
    }

    /// The sign-in it belongs to (`ServerStore`'s id): another person's is never shown.
    public var signIn: String
    public var items: [Item]

    public init(signIn: String, items: [Item]) {
        self.signIn = signIn
        self.items = items
    }
}

/// Reads and writes the snapshot in the App Group's container.
public enum TopShelf {
    /// Shared by the tvOS app and its Top Shelf extension.
    public static let appGroup = "group.com.sehalsein.strata"
    /// At most this many items: the Top Shelf shows a row, not a library.
    public static let limit = 12

    private static var file: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent("TopShelf.json")
    }

    public static func load() -> TopShelfSnapshot? {
        guard let file, let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(TopShelfSnapshot.self, from: data)
    }

    /// Saves it; false when it's what was there (nothing for the Top Shelf to reload).
    @discardableResult
    public static func save(_ snapshot: TopShelfSnapshot) -> Bool {
        guard let file, load() != snapshot, let data = try? JSONEncoder().encode(snapshot) else { return false }
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return true
    }

    /// Forgets it (signed out): the Top Shelf goes back to the app's own image.
    @discardableResult
    public static func clear() -> Bool {
        guard let file, FileManager.default.fileExists(atPath: file.path) else { return false }
        try? FileManager.default.removeItem(at: file)
        return true
    }

    /// The items of Home's Continue Watching and Up Next rows, in order.
    public static func items(from shelves: [Shelf]) -> [TopShelfSnapshot.Item] {
        let cards = shelves.filter { $0.id == "continue" || $0.id == "nextUp" }.flatMap(\.items)
        var seen = Set<String>()
        var items: [TopShelfSnapshot.Item] = []
        for card in cards {
            let episode = card.episode
            let item = TopShelfSnapshot.Item(
                ref: card.ref.description,
                title: card.title,
                subtitle: episode.map { "\($0.code) · \($0.name)" } ?? card.yearText,
                imageURL: episode?.stillUrl ?? card.backdropUrl ?? card.posterUrl,
                progress: card.progressFraction,
                season: episode?.season,
                episode: episode?.episode
            )
            guard seen.insert(item.id).inserted else { continue }
            items.append(item)
            if items.count == limit { break }
        }
        return items
    }

    /// What a `strata://play/…` link may play: only an item on the Top Shelf now, so a link
    /// from anywhere else can't start playback (it opens the title's page instead).
    public static func playable(_ url: URL, in snapshot: TopShelfSnapshot?) -> TopShelfSnapshot.Item? {
        guard url.scheme == "strata", url.host == "play", let snapshot else { return nil }
        return snapshot.items.first { $0.playURL == url }
    }
}
