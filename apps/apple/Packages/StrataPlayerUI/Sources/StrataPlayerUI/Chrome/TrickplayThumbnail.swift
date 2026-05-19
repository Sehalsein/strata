import SwiftUI
import StrataKit
import StrataDesign

/// Pluggable provider so the view doesn't know about networking. `TransportBar`
/// constructs one from the active item + image builder.
public struct TrickplayProvider: Sendable {
    public let itemId: String
    public let manifest: TrickplayManifest
    public let images: ImageURLBuilder

    public init(itemId: String, manifest: TrickplayManifest, images: ImageURLBuilder) {
        self.itemId = itemId
        self.manifest = manifest
        self.images = images
    }
}

/// Renders the trickplay tile that contains the requested second. Jellyfin
/// serves sprite sheets where each sheet packs `tileWidth × tileHeight`
/// frames at `interval` ms apart.
public struct TrickplayThumbnail: View {
    public let seconds: TimeInterval
    public let provider: TrickplayProvider

    public init(seconds: TimeInterval, provider: TrickplayProvider) {
        self.seconds = seconds
        self.provider = provider
    }

    public var body: some View {
        let m = provider.manifest
        let frame = m.frameIndex(forSeconds: seconds)
        let perSheet = max(m.tilesPerSheet, 1)
        let sheetIndex = frame / perSheet
        let frameInSheet = frame % perSheet
        let col = frameInSheet % max(m.tileWidth, 1)
        let row = frameInSheet / max(m.tileWidth, 1)

        if let url = provider.images.trickplaySheet(itemId: provider.itemId, width: m.width, sheetIndex: sheetIndex) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img):
                    GeometryReader { geo in
                        let scale = CGSize(
                            width: geo.size.width / CGFloat(m.width),
                            height: geo.size.height / CGFloat(m.height)
                        )
                        img
                            .resizable()
                            .frame(
                                width: CGFloat(m.width) * CGFloat(m.tileWidth) * scale.width,
                                height: CGFloat(m.height) * CGFloat(m.tileHeight) * scale.height
                            )
                            .offset(
                                x: -CGFloat(col) * CGFloat(m.width) * scale.width,
                                y: -CGFloat(row) * CGFloat(m.height) * scale.height
                            )
                            .clipped()
                    }
                default:
                    Strata.Tokens.bg2
                }
            }
        } else {
            Strata.Tokens.bg2
        }
    }
}
