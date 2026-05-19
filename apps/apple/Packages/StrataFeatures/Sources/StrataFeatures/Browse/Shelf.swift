import SwiftUI
import StrataKit
import StrataDesign

public struct Shelf: View {
    public let title: String
    public let items: [BaseItem]
    public let images: ImageURLBuilder?
    public let onSelect: (BaseItem) -> Void

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
                                imageURL: images?.primary(itemId: item.id, maxWidth: 800)
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
                                imageURL: images?.primary(itemId: item.id)
                            )
                            .frame(width: 160)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 1)
            }
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
        #else
        let columns = [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: 18)]
        #endif
        LazyVGrid(columns: columns, spacing: 32) {
            ForEach(items) { item in
                Button { onSelect(item) } label: {
                    Poster(
                        id: item.id,
                        title: item.displayTitle,
                        imageURL: images?.primary(itemId: item.id)
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
