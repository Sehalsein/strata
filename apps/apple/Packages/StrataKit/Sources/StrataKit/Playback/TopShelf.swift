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
        /// Landscape art: the title's backdrop when it has a logo (the two are laid together),
        /// else the episode's still or the backdrop.
        public var imageURL: URL?
        /// The title's logo, laid on `imageURL` by the app (`artworkFile`).
        public var logoURL: URL?
        /// The art with the logo on it, made by the app: a file in `TopShelf.artworkDirectory`.
        /// The Top Shelf shows it in place of `imageURL` while it's there.
        public var artworkFile: String?
        /// 0…1 watched, for the progress bar; nil for Up Next (not started).
        public var progress: Double?
        /// The episode to play, for a show.
        public var season: Int?
        public var episode: Int?

        public var id: String { [ref, season.map(String.init), episode.map(String.init)].compactMap { $0 }.joined(separator: "/") }

        public init(ref: String, title: String, subtitle: String? = nil, imageURL: URL? = nil, logoURL: URL? = nil, artworkFile: String? = nil,
                    progress: Double? = nil, season: Int? = nil, episode: Int? = nil) {
            self.ref = ref
            self.title = title
            self.subtitle = subtitle
            self.imageURL = imageURL
            self.logoURL = logoURL
            self.artworkFile = artworkFile
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

    private static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    private static var file: URL? { container?.appendingPathComponent("TopShelf.json") }

    /// Where the app keeps the art it made (backdrop and logo together).
    public static var artworkDirectory: URL? { container?.appendingPathComponent("TopShelfArt", isDirectory: true) }

    /// What the Top Shelf shows for `item`: the art made for it, while the file is there,
    /// else the remote art.
    public static func image(for item: TopShelfSnapshot.Item) -> URL? {
        if let name = item.artworkFile, let file = artworkDirectory?.appendingPathComponent(name),
           FileManager.default.fileExists(atPath: file.path) {
            return file
        }
        return item.imageURL
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
        if let dir = artworkDirectory { try? FileManager.default.removeItem(at: dir) }
        guard let file, FileManager.default.fileExists(atPath: file.path) else { return false }
        try? FileManager.default.removeItem(at: file)
        return true
    }

    /// The art file for an item: named for its art and logo, so a changed one is made again
    /// and an unchanged one is kept.
    public static func artworkName(for item: TopShelfSnapshot.Item) -> String? {
        guard let image = item.imageURL, let logo = item.logoURL else { return nil }
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in (image.absoluteString + "|" + logo.absoluteString).utf8 {
            hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211
        }
        return String(hash, radix: 16) + ".jpg"
    }

    /// The items of Home's Continue Watching and Up Next rows, in order.
    public static func items(from shelves: [Shelf]) -> [TopShelfSnapshot.Item] {
        let cards = shelves.filter { $0.id == "continue" || $0.id == "nextUp" }.flatMap(\.items)
        var seen = Set<String>()
        var items: [TopShelfSnapshot.Item] = []
        for card in cards {
            let episode = card.episode
            // With a logo, the title's own backdrop carries it (as the Apple TV app's Up Next
            // does); without one, the episode's still says which episode it is.
            let art = card.logoUrl != nil ? card.backdropUrl ?? episode?.stillUrl : episode?.stillUrl ?? card.backdropUrl
            let item = TopShelfSnapshot.Item(
                ref: card.ref.description,
                title: card.title,
                subtitle: episode.map { "\($0.code) · \($0.name)" } ?? card.yearText,
                imageURL: art ?? card.posterUrl,
                logoURL: card.logoUrl,
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
