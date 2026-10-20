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
                if !genres.isEmpty {
                    GenreChips(genres: genres, selected: $genre)
                }
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
        .toolbar { ToolbarItem(placement: .primaryAction) { ProfileToolbarButton() } }
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
                                NavigationLink(value: Route.browse(type, list)) {
                                    VStack {
                                        Image(systemName: "chevron.right").font(.title2)
                                        Text("See all").font(.stCallout)
                                    }
                                    .foregroundStyle(Theme.accentText)
                                    .frame(width: Metrics.posterWidth)
                                    .aspectRatio(2 / 3, contentMode: .fit)
                                    .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
                                }
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

/// "All" plus one chip per genre. The selected chip is filled (apricot marks the
/// selected segment); tapping it again goes back to All.
struct GenreChips: View {
    let genres: [Genre]
    @Binding var selected: Genre?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Metrics.space2) {
                chip("All", isOn: selected == nil) { selected = nil }
                ForEach(genres) { genre in
                    chip(genre.name, isOn: selected == genre) { selected = selected == genre ? nil : genre }
                }
            }
            .padding(.horizontal, Metrics.gutter)
            #if os(tvOS)
            .padding(.vertical, Metrics.space6) // room for the focus lift
            #endif
        }
        .scrollClipDisabled()
    }

    @ViewBuilder private func chip(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        #if os(tvOS)
        Button(title, action: action)
            .buttonStyle(TVChipStyle(isOn: isOn))
            .accessibilityAddTraits(isOn ? .isSelected : [])
        #else
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isOn ? Theme.onAccent : Theme.ink)
                .padding(.horizontal, Metrics.space4)
                .frame(minHeight: 36)
                .background(isOn ? AnyShapeStyle(Theme.apricot) : AnyShapeStyle(Theme.surface2), in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
        #endif
    }
}

#if os(tvOS)
/// tvOS chip: system buttons keep their tint even when focused, so the three states
/// are spelled out: focused (white, lifted), selected (apricot), resting (surface).
private struct TVChipStyle: ButtonStyle {
    let isOn: Bool

    func makeBody(configuration: Configuration) -> some View {
        Chip(label: configuration.label, isOn: isOn, pressed: configuration.isPressed)
    }

    private struct Chip<Label: View>: View {
        @Environment(\.isFocused) private var focused
        let label: Label
        let isOn: Bool
        let pressed: Bool

        var body: some View {
            label
                .font(.stCallout.weight(.semibold))
                .foregroundStyle(focused ? Theme.bg : isOn ? Theme.onAccent : Theme.ink)
                .padding(.horizontal, Metrics.space6)
                .frame(minHeight: 56)
                .background(focused ? Theme.onArtwork : isOn ? Theme.apricot : Theme.surface2, in: Capsule())
                .scaleEffect(focused ? (pressed ? 1.02 : 1.08) : 1)
                .shadow(color: .black.opacity(focused ? 0.4 : 0), radius: 12, y: 8)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: focused)
        }
    }
}
#endif

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
