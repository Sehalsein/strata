import SwiftUI
import StrataKit
import StrataDesign

/// A page's shelves as the server laid them out: a hero, numbered rankings, rails, and
/// runs of compact shelves that sit side by side.
enum ShelfBlock: Identifiable {
    case hero(Shelf)
    case ranked(Shelf)
    case rail(Shelf)
    case compact([Shelf])

    var id: String {
        switch self {
        case .hero(let s), .ranked(let s), .rail(let s): s.id
        case .compact(let shelves): shelves.map(\.id).joined(separator: "+")
        }
    }

    static func blocks(_ shelves: [Shelf]) -> [ShelfBlock] {
        var blocks: [ShelfBlock] = []
        for shelf in shelves where !shelf.items.isEmpty {
            switch shelf.style {
            case .hero: blocks.append(.hero(shelf))
            case .ranked: blocks.append(.ranked(shelf))
            case .compact:
                if case .compact(let run)? = blocks.last { blocks[blocks.count - 1] = .compact(run + [shelf]) }
                else { blocks.append(.compact([shelf])) }
            case nil: blocks.append(.rail(shelf))
            }
        }
        return blocks
    }
}

/// A ranking: each poster with its place, large, behind its left edge.
struct RankedRail: View {
    let shelf: Shelf

    var body: some View {
        Rail(shelf.title) {
            ForEach(Array(shelf.items.enumerated()), id: \.element.id) { i, card in
                NavigationLink(value: card.route) {
                    HStack(alignment: .top, spacing: -Metrics.posterWidth * 0.12) {
                        Text("\(i + 1)")
                            .font(.system(size: Metrics.posterWidth * 0.62, weight: .heavy, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink.opacity(0.22))
                            .padding(.top, Metrics.posterWidth * 0.75)
                            .accessibilityHidden(true)
                        PosterCardLabel(card: card)
                    }
                }
                .buttonStyle(StrataCardStyle())
                .accessibilityLabel("Number \(i + 1), \(card.title)")
            }
        }
    }
}

/// Short shelves side by side ("Top Airing", "Most Popular"…), each a column of small rows;
/// the columns scroll sideways where they don't all fit.
struct CompactShelves: View {
    let shelves: [Shelf]

    private var columnWidth: CGFloat {
        #if os(tvOS)
        520
        #else
        Metrics.isPad ? 340 : 300
        #endif
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: Metrics.space8) {
                ForEach(shelves) { shelf in
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        Text(shelf.title).railHeaderStyle().accessibilityAddTraits(.isHeader)
                        ForEach(shelf.items) { card in
                            NavigationLink(value: card.route) { CompactRow(card: card) }
                                .buttonStyle(StrataCardStyle())
                        }
                    }
                    .frame(width: columnWidth, alignment: .leading)
                    #if os(tvOS)
                    .focusSection()
                    #endif
                }
            }
            .padding(.horizontal, Metrics.gutter)
            #if os(tvOS)
            .padding(.vertical, Metrics.space4) // room for the focus lift
            #endif
        }
        .scrollClipDisabled()
    }
}

/// A title in a compact shelf: a small poster, its name and the server's label for it.
private struct CompactRow: View {
    let card: TitleCard

    #if os(tvOS)
    private let thumbWidth: CGFloat = 90
    #else
    private let thumbWidth: CGFloat = 52
    #endif

    var body: some View {
        HStack(spacing: Metrics.space3) {
            ArtworkImage(url: card.posterUrl, aspectRatio: 2 / 3, seed: card.id)
                .frame(width: thumbWidth)
            VStack(alignment: .leading, spacing: 4) {
                Text(card.title).font(.stHeadline).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                if let caption = card.badge ?? card.yearText {
                    Text(caption).font(.stFootnote).foregroundStyle(Theme.ink3).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([card.title, card.badge ?? card.yearText].compactMap { $0 }.joined(separator: ", "))
    }
}
