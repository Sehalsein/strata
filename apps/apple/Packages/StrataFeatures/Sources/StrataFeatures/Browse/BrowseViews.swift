import SwiftUI
import StrataKit
import StrataDesign

/// Movies or Shows tab: rails for the library and TMDB lists.
struct BrowseView: View {
    @Environment(AppServices.self) private var services
    let type: TitleType
    @State private var lists: [BrowseList: [TitleCard]] = [:]
    @State private var error: String?

    private let order: [BrowseList] = [.library, .trending, .popular, .topRated]
    private var title: String { type == .movie ? "Movies" : "Shows" }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Metrics.railGap) {
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
                            message: "Anything on TMDB. Titles you can play now show a dot.")
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
