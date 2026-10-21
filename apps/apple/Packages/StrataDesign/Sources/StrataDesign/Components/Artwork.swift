import SwiftUI

/// Remote artwork clipped to a card shape, with the strata placeholder while
/// loading and when there is no image.
public struct ArtworkImage: View {
    let url: URL?
    let aspectRatio: CGFloat
    let seed: String
    let title: String?
    let cornerRadius: CGFloat

    public init(url: URL?, aspectRatio: CGFloat, seed: String, title: String? = nil, cornerRadius: CGFloat = Metrics.cardRadius) {
        self.url = url
        self.aspectRatio = aspectRatio
        self.seed = seed
        self.title = title
        self.cornerRadius = cornerRadius
    }

    public var body: some View {
        Color.clear
            .aspectRatio(aspectRatio, contentMode: .fit)
            .overlay {
                // Shrunk to about what a card shows: a poster or a 16:9 still.
                RemoteImage(url: url, maxPixel: aspectRatio < 1 ? 600 : 960) {
                    StrataPlaceholder(seed: seed, title: title)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// Missing-artwork fill: three horizontal bands (the brand's layers) with the
/// title set over them. Variant is stable per `seed`.
public struct StrataPlaceholder: View {
    let seed: String
    let title: String?

    public init(seed: String, title: String? = nil) {
        self.seed = seed
        self.title = title
    }

    public var body: some View {
        let bands = Self.variants[Self.index(for: seed, count: Self.variants.count)]
        GeometryReader { geo in
            VStack(spacing: 0) {
                bands.0.frame(height: geo.size.height * 0.34)
                bands.1.frame(height: geo.size.height * 0.22)
                bands.2
            }
        }
        .overlay {
            if title != nil {
                LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
            }
        }
        .overlay(alignment: .bottomLeading) {
            if let title {
                Text(title)
                    .font(.stHeadline)
                    .foregroundStyle(Theme.onArtwork)
                    .lineLimit(3)
                    .shadow(color: .black.opacity(0.5), radius: 8)
                    .padding(Metrics.space3)
            }
        }
    }

    /// Full-bleed fill for heroes: the colored layer runs from the top edge so the
    /// art reads as reaching the top of the page.
    public static func hero(seed: String) -> some View {
        let tints = [Theme.apricot, Theme.local, Theme.violet, Theme.rust]
        let tint = tints[index(for: seed, count: tints.count)]
        return LinearGradient(stops: [
            .init(color: tint.opacity(0.75), location: 0),
            .init(color: tint.opacity(0.35), location: 0.55),
            .init(color: Theme.bg, location: 1),
        ], startPoint: .topTrailing, endPoint: .bottomLeading)
        .background(Theme.surface1)
    }

    private static let variants: [(Color, Color, Color)] = [
        (Theme.surface2, Theme.sand.opacity(0.45), Theme.surface1),
        (Theme.rust, Theme.apricot, Theme.sand),
        (Theme.surface3, Theme.local.opacity(0.55), Theme.surface2),
        (Theme.surface1, Theme.violet.opacity(0.5), Theme.surface3),
    ]

    static func index(for seed: String, count: Int) -> Int {
        // FNV-1a: stable across launches, unlike Swift's hashValue.
        var hash: UInt32 = 2_166_136_261
        for byte in seed.utf8 { hash = (hash ^ UInt32(byte)) &* 16_777_619 }
        return Int(hash % UInt32(count))
    }
}

/// 4pt progress bar: `apricot` on a track.
public struct ProgressBar: View {
    let fraction: Double
    let track: Color

    public init(_ fraction: Double, track: Color = Theme.surface3) {
        self.fraction = min(max(fraction, 0), 1)
        self.track = track
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(Theme.apricot).frame(width: max(4, geo.size.width * fraction))
            }
        }
        .frame(height: 4)
        .accessibilityElement()
        .accessibilityLabel("\(Int(fraction * 100)) percent watched")
    }
}
