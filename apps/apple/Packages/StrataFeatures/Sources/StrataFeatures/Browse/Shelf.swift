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
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(title.uppercased())
                    .font(.mono(11, weight: .semibold))
                    .tracking(2.5)
                    .foregroundStyle(Strata.Tokens.paperDim)
                Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
            }

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
                        #if os(macOS) || targetEnvironment(macCatalyst)
                        .onHover { hovering in
                            // visual hover is supplied by SwiftUI's default
                            _ = hovering
                        }
                        #endif
                    }
                }
                .padding(.horizontal, 1)
            }
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
        let columns = [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: 18)]
        LazyVGrid(columns: columns, spacing: 22) {
            ForEach(items) { item in
                Button { onSelect(item) } label: {
                    Poster(
                        id: item.id,
                        title: item.displayTitle,
                        imageURL: images?.primary(itemId: item.id)
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }
}
