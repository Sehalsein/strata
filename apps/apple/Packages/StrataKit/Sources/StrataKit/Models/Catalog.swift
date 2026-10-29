import Foundation

// MARK: - Cards & shelves

/// An episode reference on a continue-watching / next-up card.
public struct EpisodeRef: Codable, Sendable, Hashable {
    public var season: Int
    public var episode: Int
    public var name: String
    public var stillUrl: URL?

    public init(season: Int, episode: Int, name: String, stillUrl: URL? = nil) {
        self.season = season
        self.episode = episode
        self.name = name
        self.stillUrl = stillUrl
    }

    public var code: String { Formatting.episodeCode(season: season, episode: episode) }
}

/// A title on home/browse/search. Continue-watching cards also carry `episode`
/// (for shows) plus `positionMs`/`durationMs`.
public struct TitleCard: Codable, Sendable, Hashable, Identifiable {
    public var type: TitleType
    public var tmdbId: Int
    public var title: String
    public var year: Int?
    public var overview: String?
    public var posterUrl: URL?
    public var backdropUrl: URL?
    public var rating: Double?
    public var available: [Provider]
    public var episode: EpisodeRef?
    public var positionMs: Int?
    public var durationMs: Int?
    /// On a person's page: the character they played or their job ("Director").
    public var role: String? = nil
    /// In the Home hero: why it's featured ("Recently Added", "Trending Anime").
    public var eyebrow: String? = nil
    /// A short label from the server, shown as is ("Episode 12", "TV · 24 episodes").
    public var badge: String? = nil

    public init(type: TitleType, tmdbId: Int, title: String, year: Int? = nil, overview: String? = nil,
                posterUrl: URL? = nil, backdropUrl: URL? = nil, rating: Double? = nil, available: [Provider] = [],
                episode: EpisodeRef? = nil, positionMs: Int? = nil, durationMs: Int? = nil) {
        self.type = type
        self.tmdbId = tmdbId
        self.title = title
        self.year = year
        self.overview = overview
        self.posterUrl = posterUrl
        self.backdropUrl = backdropUrl
        self.rating = rating
        self.available = available
        self.episode = episode
        self.positionMs = positionMs
        self.durationMs = durationMs
    }

    /// Unique across types (a movie and a show can share a TMDB id). Continue-watching
    /// cards for different episodes of one show stay distinct.
    public var id: String {
        if let episode { return "\(type.rawValue)-\(tmdbId)-s\(episode.season)e\(episode.episode)" }
        return "\(type.rawValue)-\(tmdbId)"
    }

    public var yearText: String? { year.map(String.init) }
    public var ratingText: String? { Formatting.rating(rating) }
    public var isAvailable: Bool { !available.isEmpty }
    public var availabilityLabel: String? { available.isEmpty ? nil : available.label }
    /// 0...1 for continue-watching cards; nil otherwise or when nothing was watched yet.
    public var progressFraction: Double? {
        guard let positionMs, let durationMs, positionMs > 0, durationMs > 0 else { return nil }
        return Formatting.fraction(positionMs, durationMs)
    }
    public var remainingText: String? {
        guard let positionMs, let durationMs, durationMs > 0 else { return nil }
        return Formatting.remaining(ms: durationMs - positionMs)
    }

    /// What tapping Play on this card should start: the card's episode, or the movie.
    /// Nil for a show card without an episode (open the detail page instead).
    public var playbackTarget: PlaybackTarget? {
        switch type {
        case .movie: return .movie(tmdbId)
        case .show: return episode.map { .episode(show: tmdbId, season: $0.season, episode: $0.episode) }
        }
    }
}

public struct Shelf: Codable, Sendable, Hashable, Identifiable {
    public enum Kind: String, Codable, Sendable, Hashable {
        /// Continue Watching / Next Up: cards carry progress and episodes.
        case `continue`
        case titles
    }

    /// How the server wants a shelf laid out; `nil` (or one this app doesn't know) is a rail.
    public enum Style: String, Sendable, Hashable {
        /// A carousel of large artwork, each title with its buttons, at the top of the page.
        case hero
    }

    public var id: String
    public var title: String
    public var kind: Kind
    public var items: [TitleCard]
    /// The server's word for the layout, kept as sent so unknown ones still decode.
    public var styleName: String?
    public var style: Style? { styleName.flatMap(Style.init(rawValue:)) }

    enum CodingKeys: String, CodingKey {
        case id, title, kind, items
        case styleName = "style"
    }

    public init(id: String, title: String, kind: Kind, items: [TitleCard], style: Style? = nil) {
        self.id = id
        self.title = title
        self.kind = kind
        self.items = items
        self.styleName = style?.rawValue
    }
}

/// `GET /api/browse/:type/:list`
/// A TMDB genre ("Comedy", id 35), for filtering Movies and Shows.
/// An Anime tab category ("isekai", "Isekai").
public struct AnimeCategory: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct Genre: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String
    public init(id: Int, name: String) {
        self.id = id
        self.name = name
    }
}

/// `GET /api/person/:id`: a cast or crew member and their movies and shows.
public struct PersonDetail: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String
    public var biography: String?
    public var birthday: String?
    public var deathday: String?
    public var placeOfBirth: String?
    public var knownFor: String?
    public var profileUrl: URL?
    public var movies: [TitleCard]
    public var shows: [TitleCard]

    /// "Born March 3, 1972 in Toronto" / "1940 – 2016".
    public var lifeText: String? {
        let born = Formatting.date(birthday)?.formatted(date: .long, time: .omitted)
        if let died = Formatting.date(deathday) {
            let years = [Formatting.date(birthday), died].compactMap { $0 }.map { String(Calendar.current.component(.year, from: $0)) }
            return years.joined(separator: " – ")
        }
        guard let born else { return placeOfBirth.map { "Born in \($0)" } }
        return placeOfBirth.map { "Born \(born) in \($0)" } ?? "Born \(born)"
    }
}

public enum BrowseList: String, Codable, Sendable, Hashable, CaseIterable {
    case trending, popular, topRated, library

    public var title: String {
        switch self {
        case .trending: "Trending"
        case .popular: "Popular"
        case .topRated: "Top Rated"
        case .library: "Library"
        }
    }
}

// MARK: - Detail pieces

public struct CastMember: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String
    public var character: String?
    public var profileUrl: URL?
}

public struct Trailer: Codable, Sendable, Hashable {
    /// Always "youtube" today.
    public var site: String
    public var key: String
    public var name: String

    public var youtubeURL: URL? { site == "youtube" ? URL(string: "https://www.youtube.com/watch?v=\(key)") : nil }
}

/// AniList details for an anime title. Absent for everything else (and older servers).
public struct AnimeInfo: Codable, Sendable, Hashable {
    public var anilistId: Int
    public var romaji: String?
    public var native: String?
    public var studios: [String]
    /// 0–100.
    public var score: Int?
    public var nextEpisode: NextEpisode?

    public struct NextEpisode: Codable, Sendable, Hashable {
        public var episode: Int
        /// Milliseconds since 1970.
        public var airsAt: Double
        public var date: Date { Date(timeIntervalSince1970: airsAt / 1000) }
    }

    /// "葬送のフリーレン (Sousou no Frieren)".
    public var originalTitle: String? {
        switch (native, romaji) {
        case let (n?, r?) where n != r: "\(n) (\(r))"
        case let (n?, _): n
        case let (_, r?): r
        default: nil
        }
    }

    public var scoreText: String? { score.map { "\($0)%" } }

    public var nextEpisodeText: String? {
        nextEpisode.map { "Episode \($0.episode) · \($0.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))" }
    }
}

/// A trailer or extra (YouTube), for the "Trailers & Extras" rail.
public struct TitleVideo: Codable, Sendable, Hashable, Identifiable {
    public var key: String
    public var name: String
    /// "Trailer", "Teaser", "Clip", "Featurette" or "Behind the Scenes".
    public var type: String
    public var url: URL
    public var thumbnailUrl: URL?
    public var id: String { key }

    /// Built here from the video id rather than trusting the server's `url`, so a link
    /// in the catalog can only ever open YouTube.
    public var watchURL: URL? {
        var parts = URLComponents(string: "https://www.youtube.com/watch")
        parts?.queryItems = [URLQueryItem(name: "v", value: key)]
        return parts?.url
    }

    /// The thumbnail, only from YouTube's image host.
    public var safeThumbnailURL: URL? {
        guard let thumbnailUrl, thumbnailUrl.scheme == "https", thumbnailUrl.host() == "i.ytimg.com" else { return nil }
        return thumbnailUrl
    }
}

public struct CollectionRef: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String
}

// MARK: - Movie

public struct MovieDetail: Codable, Sendable, Hashable, Identifiable {
    public var type: TitleType
    public var tmdbId: Int
    public var imdbId: String?
    public var title: String
    public var tagline: String?
    public var overview: String
    public var year: Int?
    public var releaseDate: String?
    public var runtimeMinutes: Int?
    public var genres: [String]
    public var rating: Double?
    public var certification: String?
    public var posterUrl: URL?
    public var backdropUrl: URL?
    public var cast: [CastMember]
    public var directors: [String]
    public var trailer: Trailer?
    /// Absent from older servers.
    public var videos: [TitleVideo]?
    /// AniList details when this is anime.
    public var anime: AnimeInfo?
    public var collection: CollectionRef?
    public var recommendations: [TitleCard]
    public var available: [Provider]
    /// The library files that can play it.
    public var sources: [Candidate]
    public var progress: WatchProgress?
    public var inWatchlist: Bool

    public var id: String { "movie-\(tmdbId)" }
    public var target: PlaybackTarget { .movie(tmdbId) }
    public var yearText: String? { year.map(String.init) }
    public var runtimeText: String? { Formatting.runtime(minutes: runtimeMinutes) }
    public var ratingText: String? { Formatting.rating(rating) }
    public var isAvailable: Bool { !available.isEmpty }
    public var availabilityLabel: String? { available.isEmpty ? nil : available.label }
    public var releaseDateValue: Date? { Formatting.date(releaseDate) }
    /// Resume position when there's meaningful progress.
    public var resumeMs: Int? { progress.flatMap { $0.isResumable ? $0.positionMs : nil } }
}

// MARK: - Show

public struct SeasonSummary: Codable, Sendable, Hashable, Identifiable {
    public var season: Int
    public var name: String
    public var episodeCount: Int
    public var airDate: String?
    public var posterUrl: URL?
    public var availableEpisodes: Int

    public var id: Int { season }
    public var isSpecials: Bool { season == 0 }
    public var isAvailable: Bool { availableEpisodes > 0 }
}

/// Where the show's Play button goes: an in-progress episode, else the next unwatched one.
public struct UpNext: Codable, Sendable, Hashable {
    public var season: Int
    public var episode: Int
    public var positionMs: Int
    /// In the server's library, so Play can play it. Older servers don't say: treated as not.
    public var available: Bool?

    public var code: String { Formatting.episodeCode(season: season, episode: episode) }
    public var isAvailable: Bool { available ?? false }
    public var isResume: Bool { positionMs > 0 }
}

public struct ShowDetail: Codable, Sendable, Hashable, Identifiable {
    public var type: TitleType
    public var tmdbId: Int
    public var imdbId: String?
    public var title: String
    public var tagline: String?
    public var overview: String
    public var year: Int?
    public var firstAirDate: String?
    public var lastAirDate: String?
    public var status: String?
    public var genres: [String]
    public var rating: Double?
    public var certification: String?
    public var posterUrl: URL?
    public var backdropUrl: URL?
    public var cast: [CastMember]
    public var trailer: Trailer?
    /// Absent from older servers.
    public var videos: [TitleVideo]?
    /// AniList details when this is anime.
    public var anime: AnimeInfo?
    public var seasons: [SeasonSummary]
    public var recommendations: [TitleCard]
    public var available: [Provider]
    public var upNext: UpNext?
    public var inWatchlist: Bool

    public var id: String { "show-\(tmdbId)" }
    public var yearText: String? { year.map(String.init) }
    /// "2019–2023", "2020–" for running shows, or just the first year.
    public var yearRangeText: String? {
        guard let start = year else { return nil }
        let end = lastAirDate.flatMap { $0.count >= 4 ? Int($0.prefix(4)) : nil }
        let running = status == "Returning Series" || status == "In Production"
        if running { return "\(start)–" }
        if let end, end != start { return "\(start)–\(end)" }
        return String(start)
    }
    public var ratingText: String? { Formatting.rating(rating) }
    public var isAvailable: Bool { !available.isEmpty }
    public var availabilityLabel: String? { available.isEmpty ? nil : available.label }
    /// Regular seasons first (specials last), as most UIs want them.
    public var orderedSeasons: [SeasonSummary] {
        seasons.filter { !$0.isSpecials } + seasons.filter(\.isSpecials)
    }
    public var upNextTarget: PlaybackTarget? {
        upNext.map { .episode(show: tmdbId, season: $0.season, episode: $0.episode) }
    }
}

// MARK: - Season

public struct EpisodeItem: Codable, Sendable, Hashable, Identifiable {
    public var season: Int
    public var episode: Int
    public var name: String
    public var overview: String
    public var airDate: String?
    public var runtimeMinutes: Int?
    public var stillUrl: URL?
    public var rating: Double?
    public var available: [Provider]
    public var progress: WatchProgress?

    public var id: String { "s\(season)e\(episode)" }
    public var code: String { Formatting.episodeCode(season: season, episode: episode) }
    public var runtimeText: String? { Formatting.runtime(minutes: runtimeMinutes) }
    public var isAvailable: Bool { !available.isEmpty }
    public var isWatched: Bool { progress?.completed ?? false }
    public var progressFraction: Double? {
        guard let p = progress, !p.completed, p.positionMs > 0 else { return nil }
        return p.fraction
    }
    public var airDateValue: Date? { Formatting.date(airDate) }
    /// Not aired yet (air date in the future).
    public var isUpcoming: Bool { airDateValue.map { $0 > Date() } ?? false }
    public func target(show tmdbId: Int) -> PlaybackTarget { .episode(show: tmdbId, season: season, episode: episode) }
}

public struct SeasonDetail: Codable, Sendable, Hashable, Identifiable {
    public var season: Int
    public var name: String
    public var overview: String
    public var airDate: String?
    public var posterUrl: URL?
    public var episodes: [EpisodeItem]

    public var id: Int { season }
}

/// `GET /api/calendar`: an episode of a show on the profile's list, aired in the last
/// week or coming up in the next month.
public struct CalendarEpisode: Codable, Sendable, Hashable, Identifiable {
    public var tmdbId: Int
    public var title: String
    public var posterUrl: URL?
    public var backdropUrl: URL?
    /// TMDB numbering; nil for an anime episode TMDB doesn't list yet.
    public var season: Int?
    public var episode: Int
    public var name: String?
    /// The broadcast time when the server knows it (anime), as an ISO instant.
    public var airsAt: String?
    /// The air date, `YYYY-MM-DD`.
    public var airDate: String
    /// In the server's library.
    public var available: Bool

    public var id: String { "\(tmdbId)-\(season.map(String.init) ?? "x")-\(episode)-\(airDate)" }

    /// When it airs: the exact time, or the start of its air date here.
    public var date: Date {
        if let airsAt, let time = Self.instant(airsAt) { return time }
        return Self.day(airDate) ?? .distantPast
    }

    /// Whether `date` is a time of day, not just the day.
    public var hasTime: Bool { airsAt.flatMap(Self.instant) != nil }

    /// "S2 · E3" or "Episode 32".
    public var code: String {
        if let season { return "S\(season) · E\(episode)" }
        return "Episode \(episode)"
    }

    private static func instant(_ s: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    /// A TMDB air date is a calendar day, not an instant: midnight here.
    private static func day(_ s: String) -> Date? {
        let parts = s.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
