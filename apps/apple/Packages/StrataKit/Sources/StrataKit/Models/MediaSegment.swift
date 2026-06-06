import Foundation

/// A timestamped segment of an item (intro, credits, recap, …) as exposed by
/// Jellyfin's native MediaSegments API. The intro-skipper plugin (10.10+)
/// populates these, which is what powers the Skip Intro / Skip Credits buttons.
public struct MediaSegment: Codable, Hashable, Sendable, Identifiable {
    public let id: String?
    public let itemId: String?
    public let type: Kind
    public let startTicks: Int64
    public let endTicks: Int64

    public enum Kind: String, Codable, Sendable {
        case unknown = "Unknown"
        case commercial = "Commercial"
        case preview = "Preview"
        case recap = "Recap"
        case outro = "Outro"
        case intro = "Intro"

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .unknown
        }
    }

    public enum CodingKeys: String, CodingKey {
        case id = "Id"
        case itemId = "ItemId"
        case type = "Type"
        case startTicks = "StartTicks"
        case endTicks = "EndTicks"
    }

    public var start: TimeInterval { TimeInterval(startTicks) / 10_000_000 }
    public var end: TimeInterval { TimeInterval(endTicks) / 10_000_000 }

    public func contains(_ position: TimeInterval) -> Bool {
        position >= start && position < end
    }
}

struct MediaSegmentEnvelope: Codable, Sendable {
    let items: [MediaSegment]?

    enum CodingKeys: String, CodingKey {
        case items = "Items"
    }
}
