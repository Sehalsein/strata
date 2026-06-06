#if os(iOS)
import SwiftUI
import StrataDesign

struct PhoneShell: View {
    @Environment(AppServices.self) private var services
    @State private var section: AppSection = .home
    @State private var homePath: [Route] = []
    @State private var moviesPath: [Route] = []
    @State private var showsPath: [Route] = []
    @State private var searchPath: [Route] = []
    @State private var activeWatch: WatchRequest?
    @State private var searchText = ""

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                modernTabView
            } else {
                legacyTabView
            }
        }
        .tint(Strata.Tokens.accent2)
        .fullScreenCover(item: Binding(get: { activeWatch }, set: { activeWatch = $0 })) { req in
            WatchView(request: req)
        }
        .onChange(of: services.coordinator.pendingRoute) { _, new in
            applyPending(new)
        }
    }

    // MARK: - iOS 26: search-role tab (detached button + minimize)

    @available(iOS 26.0, *)
    private var modernTabView: some View {
        TabView(selection: $section) {
            Tab(AppSection.home.title, systemImage: AppSection.home.systemImage, value: AppSection.home) {
                tabStack(.home)
            }
            Tab(AppSection.movies.title, systemImage: AppSection.movies.systemImage, value: AppSection.movies) {
                tabStack(.movies)
            }
            Tab(AppSection.shows.title, systemImage: AppSection.shows.systemImage, value: AppSection.shows) {
                tabStack(.shows)
            }
            // The search role renders as a detached button; activating it
            // minimizes the other tabs and expands the system search field.
            Tab(value: AppSection.search, role: .search) {
                tabStack(.search)
            }
        }
        // Binds the system field into the search tab. Liquid Glass tab bar is
        // intentionally left untinted (no .toolbarBackground) so the
        // detach/minimize material reads correctly; dark theme still comes
        // from RootView.
        .searchable(text: $searchText)
    }

    // MARK: - iOS 17–25: classic tab bar (unchanged)

    private var legacyTabView: some View {
        TabView(selection: $section) {
            ForEach(AppSection.allCases) { sec in
                tabStack(sec)
                    .toolbarBackground(.visible, for: .tabBar)
                    .toolbarBackground(Strata.Tokens.bg, for: .tabBar)
                    .tabItem { Label(sec.title, systemImage: sec.systemImage) }
                    .tag(sec)
            }
        }
    }

    // MARK: - Shared per-tab navigation stack

    @ViewBuilder
    private func tabStack(_ sec: AppSection) -> some View {
        NavigationStack(path: bindingFor(sec)) {
            rootFor(sec)
                .navigationDestination(for: Route.self) { route in
                    if case let .watch(req) = route {
                        Color.clear.onAppear {
                            DispatchQueue.main.async {
                                popLast(sec)
                                activeWatch = req
                            }
                        }
                    } else {
                        DestinationView(path: bindingFor(sec), route: route)
                    }
                }
        }
    }

    private func applyPending(_ route: Route?) {
        guard let route else { return }
        if case let .watch(req) = route {
            activeWatch = req
        } else {
            section = .home
            homePath.append(route)
        }
        services.coordinator.pendingRoute = nil
    }

    private func bindingFor(_ section: AppSection) -> Binding<[Route]> {
        switch section {
        case .home: return $homePath
        case .movies: return $moviesPath
        case .shows: return $showsPath
        case .search: return $searchPath
        }
    }

    private func popLast(_ section: AppSection) {
        switch section {
        case .home: if !homePath.isEmpty { homePath.removeLast() }
        case .movies: if !moviesPath.isEmpty { moviesPath.removeLast() }
        case .shows: if !showsPath.isEmpty { showsPath.removeLast() }
        case .search: if !searchPath.isEmpty { searchPath.removeLast() }
        }
    }

    @ViewBuilder
    private func rootFor(_ section: AppSection) -> some View {
        switch section {
        case .home: HomeView(path: bindingFor(.home))
        case .movies: MoviesView(path: bindingFor(.movies))
        case .shows: ShowsView(path: bindingFor(.shows))
        // Pass the shared search text; SearchView only consumes it on the
        // iOS 26 search-role path and otherwise falls back to its own field.
        case .search: SearchView(path: bindingFor(.search), searchText: $searchText)
        }
    }
}
#endif
