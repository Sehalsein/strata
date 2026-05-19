#if os(tvOS)
import SwiftUI
import StrataDesign

/// tvOS shell. Uses TabView with the focus-driven top tab bar that's
/// idiomatic on Apple TV, and pushes detail / watch screens onto a
/// NavigationStack inside the active tab.
struct TVShell: View {
    @Environment(AppServices.self) private var services
    @State private var section: AppSection = .home
    @State private var homePath: [Route] = []
    @State private var moviesPath: [Route] = []
    @State private var showsPath: [Route] = []
    @State private var searchPath: [Route] = []

    var body: some View {
        TabView(selection: $section) {
            ForEach(AppSection.allCases) { sec in
                NavigationStack(path: bindingFor(sec)) {
                    rootFor(sec)
                        .navigationDestination(for: Route.self) { route in
                            DestinationView(path: bindingFor(sec), route: route)
                        }
                }
                .tabItem { Label(sec.title, systemImage: sec.systemImage) }
                .tag(sec)
            }
        }
        .onChange(of: services.coordinator.pendingRoute) { _, new in
            applyPending(new)
        }
    }

    private func bindingFor(_ section: AppSection) -> Binding<[Route]> {
        switch section {
        case .home: return $homePath
        case .movies: return $moviesPath
        case .shows: return $showsPath
        case .search: return $searchPath
        }
    }

    private func applyPending(_ route: Route?) {
        guard let route else { return }
        // tvOS doesn't have fullScreenCover; push WatchView onto the active
        // stack instead. The Siri Remote's Menu button pops it.
        switch section {
        case .home: homePath.append(route)
        case .movies: moviesPath.append(route)
        case .shows: showsPath.append(route)
        case .search: searchPath.append(route)
        }
        services.coordinator.pendingRoute = nil
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
