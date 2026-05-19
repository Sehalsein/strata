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

    var body: some View {
        TabView(selection: $section) {
            ForEach(AppSection.allCases) { sec in
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
                        .toolbarBackground(.visible, for: .tabBar)
                        .toolbarBackground(Strata.Tokens.bg, for: .tabBar)
                }
                .tabItem { Label(sec.title, systemImage: sec.systemImage) }
                .tag(sec)
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
        case .search: SearchView(path: bindingFor(.search))
        }
    }
}
#endif
