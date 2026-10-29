import SwiftUI
import StrataKit
import StrataDesign

/// The Anime tab, as the server sends it: a spotlight carousel, then rails (trending,
/// latest episodes, top airing…), with its own category menu (Isekai, Slice of Life…).
struct AnimeView: View {
    @Environment(AppServices.self) private var services
    @State private var categories: [AnimeCategory] = []
    @State private var category: AnimeCategory?
    @State private var shelves: Loadable<[Shelf]> = .loading

    var body: some View {
        ScrollView {
            PageStack {
                if let hero {
                    HeroCarousel(cards: hero.items)
                }
                #if os(tvOS)
                if hero == nil { Color.clear.frame(height: 120) } // clear the top tab bar
                if !categories.isEmpty {
                    // A full-width section: pressing down from the tab bar (or the hero)
                    // lands here first, rather than on whichever poster sits under it.
                    HStack { menu; Spacer() }
                        .padding(.horizontal, Metrics.gutter)
                        .focusSection()
                }
                #endif
                content
            }
            #if !os(tvOS)
            .padding(.top, hero == nil ? Metrics.space4 : 0)
            .padding(.bottom, Metrics.space4)
            #endif
            .padding(.bottom, Metrics.space12)
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if os(tvOS)
        .ignoresSafeArea(edges: .top)
        #else
        // The spotlight runs to the top edge, under the bar, like Home's hero.
        .ignoresSafeArea(edges: hero == nil ? [] : .top)
        .navigationTitle("Anime")
        .navigationSubtitle(category?.name ?? "")
        #if os(iOS)
        .navigationBarTitleDisplayMode(hero == nil ? .automatic : .inline)
        #endif
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
            MessageView(systemImage: "film.stack", title: "Nothing in \(category?.name ?? "Anime") yet").frame(minHeight: 400)
        case .loaded(let list):
            // The hero sits above the category menu.
            ForEach(list.filter { $0.style != .hero }) { shelf in ShelfRail(shelf: shelf) }
        }
    }

    /// The spotlight, when the server sends one (not for a category).
    private var hero: Shelf? {
        shelves.value?.first { $0.style == .hero && !$0.items.isEmpty }
    }

    private func load() async {
        shelves = .loading
        let result = await services.load { try await $0.anime(category: category?.id) }
        if case .loading = result { return }
        shelves = result
    }
}
