#if os(tvOS)
import SwiftUI
import StrataDesign

/// tvOS shell. Uses TabView with the focus-driven top tab bar that's
/// idiomatic on Apple TV. Detail screens push onto a NavigationStack inside
/// the active tab; playback is presented as a fullScreenCover so the tab
/// bar disappears while watching.
struct TVShell: View {
    @Environment(AppServices.self) private var services
    @State private var section: AppSection = .home
    @State private var homePath: [Route] = []
    @State private var moviesPath: [Route] = []
    @State private var showsPath: [Route] = []
    @State private var searchPath: [Route] = []
    @State private var watchRequest: WatchRequest?

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
        .fullScreenCover(item: $watchRequest) { request in
            WatchView(request: request)
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
        // Watch goes to a fullScreenCover so the tab bar disappears. Everything
        // else pushes onto the active tab's NavigationStack.
        switch route {
        case .watch(let req):
            watchRequest = req
        default:
            switch section {
            case .home: homePath.append(route)
            case .movies: moviesPath.append(route)
            case .shows: showsPath.append(route)
            case .search: searchPath.append(route)
            }
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
