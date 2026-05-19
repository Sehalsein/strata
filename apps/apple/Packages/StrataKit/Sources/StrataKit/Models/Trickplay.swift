import Foundation

/// Jellyfin returns trickplay manifests keyed by tile width. Each manifest
/// describes a sprite-sheet layout — frames per second, tile dimensions,
/// and the tile count per sheet image.
public struct TrickplayManifest: Codable, Hashable, Sendable {
    public let width: Int
    public let height: Int
    public let tileWidth: Int
    public let tileHeight: Int
    public let thumbnailCount: Int?
    public let interval: Int        // milliseconds between frames
    public let bandwidth: Int?

    public enum CodingKeys: String, CodingKey {
        case width = "Width"
        case height = "Height"
        case tileWidth = "TileWidth"
        case tileHeight = "TileHeight"
        case thumbnailCount = "ThumbnailCount"
        case interval = "Interval"
        case bandwidth = "Bandwidth"
    }

    /// Tile index for an absolute playback time, given that each sprite sheet
    /// packs `tileWidth × tileHeight` thumbnails.
    public func frameIndex(forSeconds seconds: TimeInterval) -> Int {
        let ms = Int(seconds * 1000)
        return ms / max(interval, 1)
    }

    public var tilesPerSheet: Int { tileWidth * tileHeight }
}
