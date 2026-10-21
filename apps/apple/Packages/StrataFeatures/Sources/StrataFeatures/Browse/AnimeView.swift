import SwiftUI
import StrataKit
import StrataDesign

/// The Anime tab: trending and seasonal series, then series and films ranked by an
/// anime catalog, with its own category menu (Isekai, Slice of Life…).
struct AnimeView: View {
    @Environment(AppServices.self) private var services
    @State private var categories: [AnimeCategory] = []
    @State private var category: AnimeCategory?
    @State private var shelves: Loadable<[Shelf]> = .loading

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Metrics.railGap) {
                #if os(tvOS)
                if category == nil, case .loaded(let list) = shelves, let feature = list.first?.items.first(where: { $0.backdropUrl != nil }) {
                    FeaturedHero(card: feature)
                } else {
                    Color.clear.frame(height: 120) // clear the top tab bar when there's no hero
                }
                if !categories.isEmpty { menu.padding(.horizontal, Metrics.gutter) }
                #endif
                content
            }
            #if !os(tvOS)
            .padding(.vertical, Metrics.space4)
            #endif
            .padding(.bottom, Metrics.space12)
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if os(tvOS)
        .ignoresSafeArea(edges: .top)
        #else
        .navigationTitle("Anime")
        .navigationSubtitle(category?.name ?? "")
        .toolbar {
            if !categories.isEmpty { ToolbarItem(placement: .primaryAction) { menu } }
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) { ProfileToolbarButton() }
        }
        .refreshable { await services.client?.clearCache(); await load() }
        #endif
        .task {
            if case .loaded(let items) = await services.load({ try await $0.animeCategories() }) { categories = items }
        }
        .task(id: category) { await load() }
    }

    private var menu: some View {
        GenreMenu(genres: categories, selected: $category, name: \.name, noun: "Category", allTitle: "All Anime")
    }

    @ViewBuilder private var content: some View {
        switch shelves {
        case .loading:
            SkeletonRail(width: Metrics.posterWidth)
            SkeletonRail(width: Metrics.posterWidth)
        case .failed(let message):
            MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load Anime", message: message, actionTitle: "Try Again") {
                Task { await load() }
            }
            .frame(minHeight: 400)
        case .loaded(let list) where list.isEmpty:
            MessageView(systemImage: "sparkles", title: "Nothing in \(category?.name ?? "Anime") yet").frame(minHeight: 400)
        case .loaded(let list):
            ForEach(list) { shelf in ShelfRail(shelf: shelf) }
        }
    }

    private func load() async {
        shelves = .loading
        let result = await services.load { try await $0.anime(category: category?.id) }
        if case .loading = result { return }
        shelves = result
    }
}
