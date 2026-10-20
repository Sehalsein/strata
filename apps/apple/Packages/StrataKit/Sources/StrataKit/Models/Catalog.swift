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

    public var id: String
    public var title: String
    public var kind: Kind
    public var items: [TitleCard]
}

/// `GET /api/browse/:type/:list`
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
    public var collection: CollectionRef?
    public var recommendations: [TitleCard]
    public var available: [Provider]
    /// Library sources only (instant). Use `StrataClient.sources(discover: true)` for releases.
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

    public var code: String { Formatting.episodeCode(season: season, episode: episode) }
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
