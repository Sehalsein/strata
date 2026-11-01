import SwiftUI
import StrataKit
import StrataDesign

/// Movies or Shows tab: genre chips, then rails for the library and TMDB lists,
/// or for the chosen genre. Shows, from a server that has its page, are laid out like
/// the Anime tab: a spotlight, then Trending, Latest Episodes and more.
struct BrowseView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.pushRoute) private var pushRoute
    let type: TitleType
    @State private var lists: [BrowseList: [TitleCard]] = [:]
    @State private var error: String?
    @State private var genres: [Genre] = []
    @State private var genre: Genre?
    @State private var genreShelves: Loadable<[Shelf]> = .loading
    /// The server's Shows page; `nil` before it loads, or from an older server.
    @State private var page: [Shelf]?

    private let order: [BrowseList] = [.trending, .popular, .topRated]
    private var title: String { type == .movie ? "Movies" : "Shows" }

    var body: some View {
        ScrollView {
            PageStack {
                if let hero, genre == nil {
                    HeroCarousel(cards: hero.items)
                }
                #if os(tvOS)
                if hero == nil || genre != nil { Color.clear.frame(height: 120) } // clear the top tab bar
                if !genres.isEmpty {
                    // Full width, so down from the tab bar reaches it (see AnimeView).
                    HStack { GenreMenu(genres: genres, selected: $genre); Spacer() }
                        .padding(.horizontal, Metrics.gutter)
                        .focusSection()
                }
                #endif
                if let genre {
                    genreContent(genre)
                } else {
                    allContent
                }
            }
            #if !os(tvOS)
            .padding(.top, showsHero ? 0 : Metrics.space4)
            #endif
            .padding(.bottom, Metrics.space4)
        }
        #if !os(tvOS)
        // The spotlight runs to the top edge, under the bar, like Home's hero.
        .heroUnderBar(showsHero)
        #endif
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if os(tvOS)
        .ignoresSafeArea(edges: .top)
        #else
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(showsHero ? .inline : .automatic)
        #endif
        // The active genre stays visible however far you scroll.
        .navigationSubtitle(genre?.name ?? "")
        .toolbar {
            if !genres.isEmpty {
                ToolbarItem(placement: .primaryAction) { GenreMenu(genres: genres, selected: $genre) }
            }
            ProfileToolbarItems()
        }
        .refreshable { await services.client?.clearCache(); await load() }
        #endif
        .task { await load() }
        .task { await loadGenres() }
        .task(id: genre) {
            guard let genre else { return }
            await loadGenre(genre)
        }
    }

    @ViewBuilder private func genreContent(_ genre: Genre) -> some View {
        switch genreShelves {
        case .loading:
            SkeletonRail(width: Metrics.posterWidth)
            SkeletonRail(width: Metrics.posterWidth)
        case .failed(let message):
            MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load \(genre.name)", message: message, actionTitle: "Try Again") {
                Task { await loadGenre(genre) }
            }
            .frame(minHeight: 300)
        case .loaded(let shelves) where shelves.isEmpty:
            MessageView(systemImage: "film.stack", title: "Nothing in \(genre.name) yet").frame(minHeight: 300)
        case .loaded(let shelves):
            ForEach(shelves) { shelf in ShelfRail(shelf: shelf) }
        }
    }

    /// The spotlight, when the server sends a Shows page with one.
    private var hero: Shelf? { page?.first { $0.style == .hero && !$0.items.isEmpty } }
    private var showsHero: Bool { hero != nil && genre == nil }

    @ViewBuilder private var allContent: some View {
                if let page {
                    ForEach(page.filter { $0.style != .hero }) { shelf in ShelfRail(shelf: shelf) }
                } else {
                    listContent
                }
    }

    @ViewBuilder private var listContent: some View {
                if lists.isEmpty, error == nil {
                    SkeletonRail(width: Metrics.posterWidth)
                    SkeletonRail(width: Metrics.posterWidth)
                }
                if let error, lists.isEmpty {
                    MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load \(title)", message: error, actionTitle: "Try Again") {
                        Task { await load() }
                    }
                    .frame(minHeight: 400)
                }
                ForEach(order, id: \.self) { list in
                    if let items = lists[list], !items.isEmpty {
                        Rail(railTitle(list), seeAll: items.count > 20 ? { pushRoute(.browse(type, list)) } : nil) {
                            ForEach(items.prefix(20)) { card in
                                NavigationLink(value: card.route) { PosterCardLabel(card: card) }
                                    .buttonStyle(StrataCardStyle())
                            }
                            #if os(tvOS)
                            if items.count > 20 {
                                NavigationLink(value: Route.browse(type, list)) { SeeAllTile() }
                                .buttonStyle(StrataCardStyle())
                            }
                            #endif
                        }
                    }
                }
    }

    private func loadGenres() async {
        if case .loaded(let items) = await services.load({ try await $0.genres(type) }) { genres = items }
    }

    private func railTitle(_ list: BrowseList) -> String {
        switch list {
        case .library: "In Your Library"
        case .trending: "Trending"
        case .popular: "Popular"
        case .topRated: "Top Rated"
        }
    }

    private func loadGenre(_ genre: Genre) async {
        genreShelves = .loading
        let result = await services.load { try await $0.genreShelves(type, genreId: genre.id) }
        if case .loading = result { return }
        genreShelves = result
    }

    private func load() async {
        // Try Again shows the skeleton again while it loads.
        if lists.isEmpty { error = nil }
        // Older servers have no Shows page: they get the lists below.
        if type == .show, let shelves = try? await services.client?.shows(), !shelves.isEmpty {
            page = shelves
            return
        }
        await withTaskGroup(of: (BrowseList, Loadable<[TitleCard]>).self) { group in
            for list in order {
                group.addTask { @MainActor in (list, await services.load { try await $0.browse(type, list: list) }) }
            }
            for await (list, result) in group {
                switch result {
                case .loaded(let items): lists[list] = items
                case .failed(let message): if list != .library { error = message }
                case .loading: break
                }
            }
        }
    }
}

/// One button that names the active genre ("All Genres", "Comedy") and opens the list,
/// so the current filter is always on screen instead of somewhere in a scrolling row.
/// Also the Anime tab's category menu.
struct GenreMenu<Item: Hashable & Identifiable>: View {
    let genres: [Item]
    @Binding var selected: Item?
    let name: (Item) -> String
    var noun = "Genre"
    var allTitle = "All Genres"

    var body: some View {
        Menu {
            Picker(noun, selection: $selected) {
                Text(allTitle).tag(Item?.none)
                ForEach(genres) { genre in Text(name(genre)).tag(Item?.some(genre)) }
            }
            .pickerStyle(.inline)
        } label: {
            #if os(tvOS)
            Label(selected.map(name) ?? allTitle, systemImage: "line.3.horizontal.decrease")
                .font(.stHeadline)
            #else
            Label(selected.map(name) ?? noun, systemImage: selected == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            #endif
        }
        #if os(tvOS)
        .buttonStyle(.glass)
        .tint(Theme.ink)
        #endif
        .accessibilityLabel(selected.map { "\(noun): \(name($0))" } ?? "Filter by \(noun.lowercased())")
    }
}

extension GenreMenu where Item == Genre {
    init(genres: [Genre], selected: Binding<Genre?>) {
        self.init(genres: genres, selected: selected, name: \.name)
    }
}

/// The poster-sized "See all" card that ends a rail.
struct SeeAllTile: View {
    var body: some View {
        // Poster-shaped: the shape sets the size, the label sits on it (a VStack given an
        // aspect ratio shrinks to its content instead).
        RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
            .fill(Theme.surface1)
            .aspectRatio(2 / 3, contentMode: .fit)
            .frame(width: Metrics.posterWidth)
            .overlay {
                VStack {
                    Image(systemName: "chevron.right").font(.title2)
                    Text("See all").font(.stCallout)
                }
                .foregroundStyle(Theme.accentText)
            }
    }
}

/// A full grid of one list ("See all").
struct BrowseListView: View {
    @Environment(AppServices.self) private var services
    let type: TitleType
    let list: BrowseList
    @State private var items: Loadable<[TitleCard]> = .loading

    var body: some View {
        ScrollView {
            switch items {
            case .loading: ProgressView().padding(Metrics.space12)
            case .failed(let message):
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load \(list.title)", message: message, actionTitle: "Try Again") {
                    Task { items = .loading; await load() }
                }
                .frame(minHeight: 400)
            case .loaded(let cards) where cards.isEmpty:
                MessageView(systemImage: "film.stack", title: "Nothing here yet").frame(minHeight: 400)
            case .loaded(let cards):
                PosterGrid {
                    ForEach(cards) { card in
                        NavigationLink(value: card.route) { PosterCardLabel(card: card, width: nil) }.buttonStyle(StrataCardStyle())
                    }
                }
                .padding(.vertical, Metrics.space4)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .navigationTitle(list.title)
        #if os(iOS)
        .refreshable { await services.client?.clearCache(); await load() }
        #endif
        .task { await load() }
    }

    private func load() async {
        let result = await services.load { try await $0.browse(type, list: list) }
        if case .loading = result { return }
        if case .failed = result, items.value != nil { return }
        items = result
    }
}

/// The Search tab. The field always shows under the title, like the TV app's: on iPhone
/// the automatic placement showed no field at all, and on iPad, in the toolbar, it was a
/// second search button beside the tab bar's Search tab.
struct SearchTab: View {
    @State private var query = ""

    var body: some View {
        #if os(iOS)
        StackHost(tab: .search) { SearchView(query: $query).searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Movies and shows") }
        #else
        StackHost(tab: .search) { SearchView(query: $query).searchable(text: $query, prompt: "Movies and shows") }
        #endif
    }
}

struct SearchView: View {
    @Environment(AppServices.self) private var services
    @Binding var query: String
    @State private var results: Loadable<[TitleCard]>?

    var body: some View {
        ScrollView {
            switch results {
            case nil:
                MessageView(systemImage: "magnifyingglass", title: "Search movies and shows",
                            message: "Find any movie or show to watch or add to My List.")
                    .frame(minHeight: 400)
            case .loading?:
                ProgressView().padding(Metrics.space12)
            case .failed(let message)?:
                MessageView(systemImage: "exclamationmark.triangle", title: "Search failed", message: message)
            case .loaded(let cards)?:
                if cards.isEmpty {
                    MessageView(systemImage: "magnifyingglass", title: "No results for “\(query)”").frame(minHeight: 400)
                } else {
                    PosterGrid {
                        ForEach(cards) { card in
                            NavigationLink(value: card.route) { PosterCardLabel(card: card, width: nil) }.buttonStyle(StrataCardStyle())
                        }
                    }
                    .padding(.vertical, Metrics.space4)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .navigationTitle("Search")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = nil; return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            // The last results stay up while typing; the spinner is only for the first search.
            if results?.value == nil { results = .loading }
            let result = await services.load { try await $0.search(q) }
            if !Task.isCancelled { results = result }
        }
    }
}

/// The account's watchlist, from the server's My List shelf.
struct MyListView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.showsSidebar) private var showsSidebar
    @State private var items: Loadable<[TitleCard]> = .loading

    var body: some View {
        ScrollView {
            switch items {
            case .loading: ProgressView().padding(Metrics.space12)
            case .failed(let message):
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load My List", message: message)
            case .loaded(let cards) where cards.isEmpty:
                MessageView(systemImage: "bookmark", title: "Your list is empty", message: "Add movies and shows with My List on their page.")
                    .frame(minHeight: 400)
            case .loaded(let cards):
                PosterGrid {
                    ForEach(cards) { card in
                        NavigationLink(value: card.route) { PosterCardLabel(card: card, width: nil) }.buttonStyle(StrataCardStyle())
                    }
                }
                .padding(.vertical, Metrics.space4)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .navigationTitle("My List")
        #if os(iOS)
        // The iPad sidebar has Downloads.
        .toolbar {
            if !showsSidebar {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink { DownloadsView() } label: { Label("Downloads", systemImage: "arrow.down.circle") }
                }
            }
        }
        .refreshable { await services.client?.clearCache(); items = await services.load { try await $0.watchlist() } }
        #endif
        .task {
            await services.client?.clearCache()
            items = await services.load { try await $0.watchlist() }
        }
    }
}
