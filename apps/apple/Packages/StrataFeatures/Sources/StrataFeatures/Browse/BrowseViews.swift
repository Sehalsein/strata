import SwiftUI
import StrataKit
import StrataDesign

/// Movies or Shows tab: genre chips, then rails for the library and TMDB lists,
/// or for the chosen genre.
struct BrowseView: View {
    @Environment(AppServices.self) private var services
    let type: TitleType
    @State private var lists: [BrowseList: [TitleCard]] = [:]
    @State private var error: String?
    @State private var genres: [Genre] = []
    @State private var genre: Genre?
    @State private var genreShelves: Loadable<[Shelf]> = .loading

    private let order: [BrowseList] = [.library, .trending, .popular, .topRated]
    private var title: String { type == .movie ? "Movies" : "Shows" }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Metrics.railGap) {
                #if os(tvOS)
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
            .padding(.vertical, Metrics.space4)
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if !os(tvOS)
        .navigationTitle(title)
        // The active genre stays visible however far you scroll.
        .navigationSubtitle(genre?.name ?? "")
        .toolbar {
            if !genres.isEmpty {
                ToolbarItem(placement: .primaryAction) { GenreMenu(genres: genres, selected: $genre) }
            }
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) { ProfileToolbarButton() }
        }
        .refreshable { await services.client?.clearCache(); await load() }
        #endif
        .task { await load() }
        .task { await loadGenres() }
        .task(id: genre) {
            guard let genre else { return }
            genreShelves = .loading
            let result = await services.load { try await $0.genreShelves(type, genreId: genre.id) }
            if case .loading = result { return }
            genreShelves = result
        }
    }

    @ViewBuilder private func genreContent(_ genre: Genre) -> some View {
        switch genreShelves {
        case .loading:
            SkeletonRail(width: Metrics.posterWidth)
            SkeletonRail(width: Metrics.posterWidth)
        case .failed(let message):
            MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load \(genre.name)", message: message).frame(minHeight: 300)
        case .loaded(let shelves) where shelves.isEmpty:
            MessageView(systemImage: "film.stack", title: "Nothing in \(genre.name) yet").frame(minHeight: 300)
        case .loaded(let shelves):
            ForEach(shelves) { shelf in ShelfRail(shelf: shelf) }
        }
    }

    @ViewBuilder private var allContent: some View {
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
                        Rail(railTitle(list), seeAll: nil) {
                            ForEach(items.prefix(20)) { card in
                                NavigationLink(value: card.route) { PosterCardLabel(card: card) }
                                    .buttonStyle(StrataCardStyle())
                            }
                            if items.count > 20 {
                                NavigationLink(value: Route.browse(type, list)) { SeeAllTile() }
                                .buttonStyle(StrataCardStyle())
                            }
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
        case .trending: "Trending This Week"
        case .popular: "Popular"
        case .topRated: "Top Rated"
        }
    }

    private func load() async {
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
        VStack {
            Image(systemName: "chevron.right").font(.title2)
            Text("See all").font(.stCallout)
        }
        .foregroundStyle(Theme.accentText)
        .frame(width: Metrics.posterWidth)
        .aspectRatio(2 / 3, contentMode: .fit)
        .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
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
            case .failed(let message): MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load", message: message)
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
        .task { items = await services.load { try await $0.browse(type, list: list) } }
    }
}

struct SearchView: View {
    @Environment(AppServices.self) private var services
    @State private var query = ""
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
        .searchable(text: $query, prompt: "Movies and shows")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = nil; return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            results = .loading
            let result = await services.load { try await $0.search(q) }
            if !Task.isCancelled { results = result }
        }
    }
}

/// The profile's watchlist, from the server's My List shelf.
struct MyListView: View {
    @Environment(AppServices.self) private var services
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
        .task {
            await services.client?.clearCache()
            items = await services.load { try await $0.home().first { $0.id == "watchlist" }?.items ?? [] }
        }
    }
}
