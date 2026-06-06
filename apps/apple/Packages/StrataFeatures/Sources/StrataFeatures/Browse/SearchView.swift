import SwiftUI
import StrataKit
import StrataDesign

public struct SearchView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    let initialQuery: String?

    @State private var term: String = ""
    @State private var results: [BaseItem] = []
    @State private var searchError: String?
    @State private var isSearching = false
    @State private var recents: [RecentSearch] = RecentSearchStore.load()
    @State private var searchTask: Task<Void, Never>?
    #if !os(tvOS)
    @FocusState private var focused: Bool
    #endif

    public init(path: Binding<[Route]>, initialQuery: String? = nil) {
        self._path = path
        self.initialQuery = initialQuery
    }

    public var body: some View {
        #if os(tvOS)
        tvBody
        #else
        phoneBody
        #endif
    }

    // MARK: - Shared search plumbing

    private func scheduleSearch() {
        searchTask?.cancel()
        let snapshot = term
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            await runSearch(snapshot)
        }
    }

    private func runSearch(_ q: String) async {
        guard let client = services.client else { return }
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            await MainActor.run { results = []; searchError = nil; isSearching = false }
            return
        }
        await MainActor.run { isSearching = true }
        do {
            let result = try await client.search(trimmed)
            await MainActor.run {
                // One ranked list, films then series — the native search shows
                // a single results column rather than separate rails.
                results = result.movies + result.shows
                searchError = nil
                isSearching = false
            }
        } catch is CancellationError {
            // superseded by a newer keystroke
        } catch let error as JellyfinClient.RequestError {
            await MainActor.run { searchError = error.message; isSearching = false }
        } catch {
            await MainActor.run { searchError = (error as NSError).localizedDescription; isSearching = false }
        }
    }

    private func typeLabel(_ kind: ItemKind?) -> String {
        switch kind {
        case .movie: return "Movie"
        case .series: return "TV Show"
        case .episode: return "Episode"
        case .boxSet: return "Collection"
        default: return "Title"
        }
    }

    private func addRecent(from item: BaseItem) {
        let entry = RecentSearch(
            id: item.id,
            title: item.displayTitle,
            subtitle: typeLabel(item.type),
            isShow: item.type == .series
        )
        recents.removeAll { $0.id == entry.id }
        recents.insert(entry, at: 0)
        if recents.count > 12 { recents = Array(recents.prefix(12)) }
        RecentSearchStore.save(recents)
    }

    private func clearRecents() {
        recents = []
        RecentSearchStore.save(recents)
    }
}

// MARK: - iOS / macOS (bottom-pinned, native-style search)

#if !os(tvOS)
private extension SearchView {
    var phoneBody: some View {
        ZStack {
            AmbientBackdrop(key: "search", intensity: 0.6)
            content
        }
        .safeAreaInset(edge: .bottom) { searchBar }
        .onAppear {
            if term.isEmpty, let q = initialQuery, !q.isEmpty {
                term = q
                scheduleSearch()
            } else if term.isEmpty {
                focused = true
            }
        }
    }

    @ViewBuilder
    var content: some View {
        if term.isEmpty {
            recentsList
        } else {
            resultsList
        }
    }

    var recentsList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if recents.isEmpty {
                    emptyHint
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Recently Searched")
                            .font(.fraunces(22, opticalSize: 40, soft: 40))
                            .foregroundStyle(Strata.Tokens.paper)
                        Spacer()
                        Button("Clear") { clearRecents() }
                            .font(.plex(15, weight: .semibold))
                            .foregroundStyle(Strata.Tokens.accent)
                            .buttonStyle(.plain)
                    }
                    .padding(.bottom, 10)
                    ForEach(recents) { recent in
                        Button { openRecent(recent) } label: {
                            SearchRow(
                                imageURL: services.images?.primary(itemId: recent.id, maxWidth: 200),
                                title: recent.title,
                                subtitle: recent.subtitle
                            )
                        }
                        .buttonStyle(.plain)
                        if recent.id != recents.last?.id { rowDivider }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    var resultsList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let searchError, results.isEmpty {
                    ErrorRetryView(message: searchError, retry: { scheduleSearch() })
                        .frame(minHeight: 240)
                } else if results.isEmpty && !isSearching {
                    noResults
                } else {
                    ForEach(results) { item in
                        Button { open(item) } label: {
                            SearchRow(
                                imageURL: services.images?.primary(itemId: item.id, maxWidth: 200),
                                title: item.displayTitle,
                                subtitle: typeLabel(item.type)
                            )
                        }
                        .buttonStyle(.plain)
                        if item.id != results.last?.id { rowDivider }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    var searchBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Strata.Tokens.paperDim)
                TextField("Search", text: $term)
                    .focused($focused)
                    .font(.plex(17))
                    .foregroundStyle(Strata.Tokens.paper)
                    .tint(Strata.Tokens.accent)
                    .submitLabel(.search)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                    .onChange(of: term) { _, _ in scheduleSearch() }
                    .onSubmit { scheduleSearch() }
                if !term.isEmpty {
                    Button { term = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(Strata.Tokens.paperDim)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Capsule().fill(Strata.Tokens.paper.opacity(0.1)))
            .overlay(Capsule().stroke(Strata.Tokens.paperHair, lineWidth: 1))

            if focused {
                Button {
                    term = ""
                    focused = false
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Strata.Tokens.paper)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Strata.Tokens.paper.opacity(0.1)))
                        .overlay(Circle().stroke(Strata.Tokens.paperHair, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
        .animation(.easeOut(duration: 0.2), value: focused)
    }

    var rowDivider: some View {
        Rectangle()
            .fill(Strata.Tokens.paperHair)
            .frame(height: 1)
            .padding(.leading, 68)
    }

    var emptyHint: some View {
        VStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Strata.Tokens.paperDim)
            Text("Search films and series")
                .font(.plex(15))
                .foregroundStyle(Strata.Tokens.paperDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 90)
    }

    var noResults: some View {
        VStack(spacing: 8) {
            Text("No results")
                .font(.fraunces(22, opticalSize: 40, soft: 40))
                .foregroundStyle(Strata.Tokens.paper)
            Text("Nothing matched \u{201C}\(term)\u{201D}.")
                .font(.plex(14))
                .foregroundStyle(Strata.Tokens.paperDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 90)
    }

    func open(_ item: BaseItem) {
        addRecent(from: item)
        focused = false
        path.append(defaultRoute(for: item))
    }

    func openRecent(_ recent: RecentSearch) {
        focused = false
        path.append(recent.isShow ? .show(id: recent.id) : .movie(id: recent.id))
    }
}

/// One result / recent row: small poster, title, and type subtitle.
private struct SearchRow: View {
    let imageURL: URL?
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(Strata.Tokens.bg2)
                AsyncImage(url: imageURL) { phase in
                    if case .success(let img) = phase {
                        img.resizable().scaledToFill()
                    }
                }
            }
            .frame(width: 54, height: 80)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.plex(17, weight: .semibold))
                    .foregroundStyle(Strata.Tokens.paper)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.plex(14))
                    .foregroundStyle(Strata.Tokens.paperDim)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}
#endif

// MARK: - tvOS (focus-driven, unchanged shape)

#if os(tvOS)
private extension SearchView {
    var tvBody: some View {
        ZStack {
            AmbientBackdrop(key: "search", intensity: 0.6)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("SEARCH").strataSpec()
                    TextField("Title, year, genre…", text: $term)
                        .font(.fraunces(28, opticalSize: 96, soft: 50))
                        .foregroundStyle(Strata.Tokens.paper)
                        .autocorrectionDisabled()
                        .onChange(of: term) { _, _ in scheduleSearch() }

                    let films = results.filter { $0.type == .movie }
                    let series = results.filter { $0.type == .series }
                    if !films.isEmpty {
                        Shelf(title: "Films", items: films, images: services.images) { path.append(.movie(id: $0.id)) }
                    }
                    if !series.isEmpty {
                        Shelf(title: "Series", items: series, images: services.images) { path.append(.show(id: $0.id)) }
                    }
                }
                .padding(.horizontal, 28)
                .padding(.top, 32)
                .padding(.bottom, CGFloat.strataScrollBottom)
            }
        }
        .onAppear {
            if term.isEmpty, let q = initialQuery, !q.isEmpty {
                term = q
                scheduleSearch()
            }
        }
    }
}
#endif

// MARK: - Recently searched persistence

struct RecentSearch: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let subtitle: String
    let isShow: Bool
}

enum RecentSearchStore {
    private static let key = "strata.recentSearches"

    static func load() -> [RecentSearch] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([RecentSearch].self, from: data)) ?? []
    }

    static func save(_ items: [RecentSearch]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(items), forKey: key)
    }
}
