import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct HomeView: View {
    @Environment(AppServices.self) private var services
    @State private var shelves: Loadable<[Shelf]> = .loading

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Metrics.railGap) {
                switch shelves {
                case .loading:
                    SkeletonRail(aspectRatio: 16 / 9, width: Metrics.landscapeWidth)
                    SkeletonRail(width: Metrics.posterWidth)
                case .failed(let message):
                    MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load Home", message: message, actionTitle: "Try Again") {
                        Task { await load(force: true) }
                    }
                    .frame(minHeight: 400)
                case .loaded(let list):
                    #if os(tvOS)
                    if let feature = featured(in: list) {
                        FeaturedHero(card: feature)
                    } else {
                        Color.clear.frame(height: 120) // clear the top tab bar when there's no hero
                    }
                    #endif
                    if list.isEmpty {
                        MessageView(systemImage: "film.stack", title: "Nothing here yet",
                                    message: "Add media folders or a TorBox key in your server's dashboard.")
                            .frame(minHeight: 400)
                    }
                    ForEach(list) { shelf in ShelfRail(shelf: shelf) }
                }
            }
            #if !os(tvOS)
            .padding(.top, Metrics.space4)
            #endif
            .padding(.bottom, Metrics.space12)
        }
        #if os(tvOS)
        .ignoresSafeArea(edges: .top)
        #else
        .navigationTitle("Home")
        .toolbar { ToolbarItem(placement: .primaryAction) { ProfileToolbarButton() } }
        .refreshable { await load(force: true) }
        #endif
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .task { await load(force: false) }
    }

    private func load(force: Bool) async {
        if force { await services.client?.clearCache() }
        let result = await services.load { try await $0.home() }
        if case .loading = result { return }
        shelves = result
    }

    private func featured(in list: [Shelf]) -> TitleCard? {
        let titles = list.first { $0.id == "trendingMovies" } ?? list.first { $0.kind == .titles }
        return titles?.items.first { $0.backdropUrl != nil }
    }
}

/// One server shelf as a rail of the right card type.
struct ShelfRail: View {
    @Environment(AppServices.self) private var services
    let shelf: Shelf

    var body: some View {
        Rail(shelf.title) {
            ForEach(shelf.items) { card in
                if shelf.kind == .continue {
                    ContinueCard(id: card.id,
                                 overline: card.episode?.code ?? card.yearText,
                                 title: card.episode?.name ?? card.title,
                                 subtitle: card.episode != nil ? card.title : card.remainingText,
                                 imageURL: card.episode?.stillUrl ?? card.backdropUrl,
                                 artworkTitle: card.title,
                                 progress: card.progressFraction,
                                 width: Metrics.landscapeWidth) {
                        if let request = card.watchRequest() { services.play(request) }
                    }
                    .contextMenu {
                        NavigationLink(value: card.route) { Label(card.type == .show ? "Go to Show" : "Go to Movie", systemImage: "info.circle") }
                        Button { if let r = card.watchRequest(restart: true) { services.play(r) } } label: { Label("Play from Beginning", systemImage: "arrow.counterclockwise") }
                    }
                } else {
                    NavigationLink(value: card.route) {
                        PosterCardLabel(card: card)
                    }
                    .buttonStyle(StrataCardStyle())
                }
            }
        }
    }
}

/// Poster artwork and caption for a title, for use inside a NavigationLink.
struct PosterCardLabel: View {
    let card: TitleCard

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            ArtworkImage(url: card.posterUrl, aspectRatio: 2 / 3, seed: card.id, title: card.title)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                HStack(spacing: Metrics.space2) {
                    if let provider = card.providerKinds.first {
                        Circle().fill(provider.color).frame(width: 6, height: 6).accessibilityLabel("On \(provider.label)")
                    }
                    if let year = card.yearText { Text(year) }
                }
                .font(.stFootnote)
                .foregroundStyle(Theme.ink3)
            }
            #if os(tvOS)
            .opacity(0.9)
            #endif
        }
        .frame(width: Metrics.posterWidth)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([card.title, card.yearText, card.providerKinds.first.map { "on \($0.label)" }].compactMap { $0 }.joined(separator: ", "))
    }
}

#if os(tvOS)
/// The tvOS Home hero: a trending title with Play and More Info.
private struct FeaturedHero: View {
    @Environment(AppServices.self) private var services
    let card: TitleCard

    var body: some View {
        HeroBillboard(id: card.id, backdropURL: card.backdropUrl, eyebrow: card.isAvailable ? "In your library" : "Trending this week",
                      title: card.title, meta: [card.yearText, card.ratingText].compactMap { $0 }, overview: card.overview) {
            if card.type == .movie {
                PlayButton("Play") {
                    services.play(WatchRequest(target: .movie(card.tmdbId), meta: PlaybackMeta(title: card.title, subtitle: card.yearText, artworkURL: card.backdropUrl)))
                }
            }
            NavigationLink(value: card.route) { Label("More Info", systemImage: "info.circle").font(.stHeadline) }
                .buttonStyle(.glass)
        }
    }
}
#endif
