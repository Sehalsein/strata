import SwiftUI
import StrataKit
import StrataDesign

public struct Shelf: View {
    public let title: String
    public let items: [BaseItem]
    public let images: ImageURLBuilder?
    public let onSelect: (BaseItem) -> Void
    @Environment(\.pageGutter) private var pageGutter

    public init(title: String, items: [BaseItem], images: ImageURLBuilder?, onSelect: @escaping (BaseItem) -> Void) {
        self.title = title
        self.items = items
        self.images = images
        self.onSelect = onSelect
    }

    public var body: some View {
        #if os(tvOS)
        VStack(alignment: .leading, spacing: 24) {
            shelfHeader
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 28) {
                    ForEach(items) { item in
                        Button { onSelect(item) } label: {
                            Poster(
                                id: item.id,
                                title: item.displayTitle,
                                imageURL: images?.primary(itemId: item.id, maxWidth: 800),
                                badge: item.type == .boxSet ? "Collection" : nil
                            )
                            .frame(width: 280)
                        }
                        .buttonStyle(StrataCardButtonStyle())
                    }
                }
                // Focus needs room to scale 1.06× without clipping at the edge.
                .padding(.horizontal, 8)
                .padding(.vertical, 16)
            }
        }
        #else
        VStack(alignment: .leading, spacing: 14) {
            shelfHeader
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 16) {
                    ForEach(items) { item in
                        Button { onSelect(item) } label: {
                            Poster(
                                id: item.id,
                                title: item.displayTitle,
                                // 160pt card on a 3× display ≈ 480px; ask for
                                // 360 rather than the 720 default to cut grid
                                // bandwidth without visible softening.
                                imageURL: images?.primary(itemId: item.id, maxWidth: 360),
                                badge: item.type == .boxSet ? "Collection" : nil
                            )
                            .frame(width: 160)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .fullBleedRow(gutter: pageGutter)
        }
        #endif
    }

    private var shelfHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(title.uppercased())
                #if os(tvOS)
                .font(.mono(18, weight: .semibold))
                .tracking(3.2)
                #else
                .font(.mono(11, weight: .semibold))
                .tracking(2.5)
                #endif
                .foregroundStyle(Strata.Tokens.paper)
            Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
        }
    }
}

/// Horizontal "Continue Watching" rail: wide thumb artwork + resume progress
/// bar, instead of the 2:3 poster row used by `Shelf`.
public struct ContinueShelf: View {
    public let title: String
    public let items: [BaseItem]
    public let images: ImageURLBuilder?
    public let onSelect: (BaseItem) -> Void
    @Environment(\.pageGutter) private var pageGutter

    public init(title: String, items: [BaseItem], images: ImageURLBuilder?, onSelect: @escaping (BaseItem) -> Void) {
        self.title = title
        self.items = items
        self.images = images
        self.onSelect = onSelect
    }

    public var body: some View {
        #if os(tvOS)
        let cardWidth: CGFloat = 460
        let spacing: CGFloat = 28
        #else
        let cardWidth: CGFloat = 280
        let spacing: CGFloat = 16
        #endif
        VStack(alignment: .leading, spacing: 14) {
            shelfHeader
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: spacing) {
                    ForEach(items) { item in
                        Button { onSelect(item) } label: {
                            ContinueCard(
                                id: item.id,
                                title: cardTitle(item),
                                overline: cardOverline(item),
                                imageURL: artwork(for: item, maxWidth: Int(cardWidth) * 2),
                                progress: item.watchedFraction ?? 0
                            )
                            .frame(width: cardWidth)
                        }
                        #if os(tvOS)
                        .buttonStyle(StrataCardButtonStyle())
                        #else
                        .buttonStyle(.plain)
                        #endif
                    }
                }
                #if os(tvOS)
                .padding(.horizontal, 8)
                .padding(.vertical, 16)
                #endif
            }
            #if !os(tvOS)
            .fullBleedRow(gutter: pageGutter)
            #endif
        }
    }

    /// For episodes show the series name as the card title; otherwise the
    /// item's own title.
    private func cardTitle(_ item: BaseItem) -> String {
        if item.type == .episode, let series = item.seriesName, !series.isEmpty {
            return series
        }
        return item.displayTitle
    }

    /// Episodes get an "S01·E03" overline; everything else falls back to the
    /// production year.
    private func cardOverline(_ item: BaseItem) -> String? {
        if item.type == .episode {
            let s = item.parentIndexNumber ?? 1
            let e = item.indexNumber ?? 1
            return String(format: "S%02d·E%02d", s, e)
        }
        if let year = item.productionYear { return String(year) }
        return nil
    }

    /// Pick the best wide artwork by inspecting which image tags the item
    /// actually has — `thumb()`/`backdrop()` build a URL unconditionally, so we
    /// must check tags to avoid pointing at an image Jellyfin will 404. Order:
    /// episode still → Thumb → Backdrop. Returns nil so the card's procedural
    /// motif shows through when none exist.
    private func artwork(for item: BaseItem, maxWidth: Int) -> URL? {
        if item.type == .episode {
            return images?.episodeStill(itemId: item.id, imageTags: item.imageTags, maxWidth: maxWidth)
        }
        if item.imageTags?["Thumb"] != nil {
            return images?.thumb(itemId: item.id, maxWidth: maxWidth)
        }
        if let backdrops = item.backdropImageTags, !backdrops.isEmpty {
            return images?.backdrop(itemId: item.id, maxWidth: maxWidth)
        }
        return nil
    }

    private var shelfHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(title.uppercased())
                #if os(tvOS)
                .font(.mono(18, weight: .semibold))
                .tracking(3.2)
                #else
                .font(.mono(11, weight: .semibold))
                .tracking(2.5)
                #endif
                .foregroundStyle(Strata.Tokens.paper)
            Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
        }
    }
}

public struct PosterGrid: View {
    public let items: [BaseItem]
    public let images: ImageURLBuilder?
    public let onSelect: (BaseItem) -> Void

    public init(items: [BaseItem], images: ImageURLBuilder?, onSelect: @escaping (BaseItem) -> Void) {
        self.items = items
        self.images = images
        self.onSelect = onSelect
    }

    public var body: some View {
        #if os(tvOS)
        let columns = [GridItem(.adaptive(minimum: 220, maximum: 280), spacing: 32)]
        let posterWidth = 800
        #else
        let columns = [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: 18)]
        let posterWidth = 500
        #endif
        LazyVGrid(columns: columns, spacing: 32) {
            ForEach(items) { item in
                Button { onSelect(item) } label: {
                    Poster(
                        id: item.id,
                        title: item.displayTitle,
                        imageURL: images?.primary(itemId: item.id, maxWidth: posterWidth),
                        badge: item.type == .boxSet ? "Collection" : nil
                    )
                }
                #if os(tvOS)
                .buttonStyle(StrataCardButtonStyle())
                #else
                .buttonStyle(.plain)
                #endif
            }
        }
    }
}
