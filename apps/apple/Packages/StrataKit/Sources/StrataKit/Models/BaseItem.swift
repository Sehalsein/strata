import Foundation

public struct BaseItem: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String?
    public let originalTitle: String?
    public let type: ItemKind?
    public let overview: String?
    public let taglines: [String]?
    public let genres: [String]?
    public let productionYear: Int?
    public let officialRating: String?
    public let communityRating: Double?
    public let premiereDate: String?
    public let runtimeTicks: Int64?
    public let imageTags: [String: String]?
    public let backdropImageTags: [String]?
    public let seriesId: String?
    public let seriesName: String?
    public let seasonId: String?
    public let seasonName: String?
    public let parentIndexNumber: Int?
    public let indexNumber: Int?
    public let userData: UserData?
    public let mediaSources: [MediaSource]?
    public let mediaStreams: [MediaStream]?
    public let chapters: [Chapter]?

    public enum CodingKeys: String, CodingKey {
        case id = "Id"
        case name = "Name"
        case originalTitle = "OriginalTitle"
        case type = "Type"
        case overview = "Overview"
        case taglines = "Taglines"
        case genres = "Genres"
        case productionYear = "ProductionYear"
        case officialRating = "OfficialRating"
        case communityRating = "CommunityRating"
        case premiereDate = "PremiereDate"
        case runtimeTicks = "RunTimeTicks"
        case imageTags = "ImageTags"
        case backdropImageTags = "BackdropImageTags"
        case seriesId = "SeriesId"
        case seriesName = "SeriesName"
        case seasonId = "SeasonId"
        case seasonName = "SeasonName"
        case parentIndexNumber = "ParentIndexNumber"
        case indexNumber = "IndexNumber"
        case userData = "UserData"
        case mediaSources = "MediaSources"
        case mediaStreams = "MediaStreams"
        case chapters = "Chapters"
    }
}

public enum ItemKind: String, Codable, Hashable, Sendable {
    case movie = "Movie"
    case series = "Series"
    case season = "Season"
    case episode = "Episode"
    case folder = "Folder"
    case collectionFolder = "CollectionFolder"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ItemKind(rawValue: raw) ?? .unknown
    }
}

public struct UserData: Codable, Hashable, Sendable {
    public let playbackPositionTicks: Int64?
    public let playCount: Int?
    public let isFavorite: Bool?
    public let played: Bool?
    public let playedPercentage: Double?

    public enum CodingKeys: String, CodingKey {
        case playbackPositionTicks = "PlaybackPositionTicks"
        case playCount = "PlayCount"
        case isFavorite = "IsFavorite"
        case played = "Played"
        case playedPercentage = "PlayedPercentage"
    }
}

public struct Chapter: Codable, Hashable, Sendable {
    public let name: String?
    public let startPositionTicks: Int64

    public enum CodingKeys: String, CodingKey {
        case name = "Name"
        case startPositionTicks = "StartPositionTicks"
    }
}

public extension BaseItem {
    var runtimeSeconds: TimeInterval? {
        guard let runtimeTicks else { return nil }
        return TimeInterval(runtimeTicks) / 10_000_000
    }

    var resumePositionSeconds: TimeInterval? {
        guard let ticks = userData?.playbackPositionTicks, ticks > 0 else { return nil }
        return TimeInterval(ticks) / 10_000_000
    }

    var displayTitle: String { name ?? originalTitle ?? "Untitled" }
}
