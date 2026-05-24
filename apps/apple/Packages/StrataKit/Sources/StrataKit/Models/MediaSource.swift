import Foundation

public struct MediaSource: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let container: String?
    public let name: String?
    public let path: String?
    public let bitrate: Int?
    public let runTimeTicks: Int64?
    public let mediaStreams: [MediaStream]?
    /// Whether Jellyfin determined the source is playable as-is given the
    /// DeviceProfile we sent. Authoritative; prefer this over guessing
    /// from container/codec fields.
    public let supportsDirectPlay: Bool?
    /// Whether Jellyfin can remux (no re-encode) into a profile-compatible
    /// container. Useful as a middle option between DirectPlay and full
    /// transcode but currently not used by the player.
    public let supportsDirectStream: Bool?
    /// Server-built transcode URL incorporating the negotiated profile
    /// — e.g. `-c:v copy` with audio-only transcode when video matches
    /// the profile. Prefer this over hand-building `master.m3u8`.
    public let transcodingUrl: String?

    public enum CodingKeys: String, CodingKey {
        case id = "Id"
        case container = "Container"
        case name = "Name"
        case path = "Path"
        case bitrate = "Bitrate"
        case runTimeTicks = "RunTimeTicks"
        case mediaStreams = "MediaStreams"
        case supportsDirectPlay = "SupportsDirectPlay"
        case supportsDirectStream = "SupportsDirectStream"
        case transcodingUrl = "TranscodingUrl"
    }
}

public struct MediaStream: Codable, Hashable, Sendable {
    public let index: Int
    public let type: StreamKind
    public let codec: String?
    public let language: String?
    public let displayTitle: String?
    public let title: String?
    public let isDefault: Bool?
    public let isForced: Bool?
    public let bitRate: Int?
    public let channels: Int?
    public let height: Int?
    public let width: Int?

    public enum CodingKeys: String, CodingKey {
        case index = "Index"
        case type = "Type"
        case codec = "Codec"
        case language = "Language"
        case displayTitle = "DisplayTitle"
        case title = "Title"
        case isDefault = "IsDefault"
        case isForced = "IsForced"
        case bitRate = "BitRate"
        case channels = "Channels"
        case height = "Height"
        case width = "Width"
    }
}

public enum StreamKind: String, Codable, Hashable, Sendable {
    case video = "Video"
    case audio = "Audio"
    case subtitle = "Subtitle"
    case data = "Data"
    case embeddedImage = "EmbeddedImage"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = StreamKind(rawValue: raw) ?? .unknown
    }
}
