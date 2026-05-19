#if os(macOS)
import SwiftUI
import StrataDesign

struct MacShell: View {
    @Environment(AppServices.self) private var services
    @State private var section: AppSection? = .home
    @State private var path: [Route] = []
    @State private var activeWatch: WatchRequest?

    var body: some View {
        NavigationSplitView {
            Sidebar(selection: $section)
                .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
        } detail: {
            NavigationStack(path: $path) {
                root
                    .navigationDestination(for: Route.self) { route in
                        if case let .watch(req) = route {
                            Color.clear.onAppear {
                                DispatchQueue.main.async {
                                    if !path.isEmpty { path.removeLast() }
                                    activeWatch = req
                                }
                            }
                        } else {
                            DestinationView(path: $path, route: route)
                        }
                    }
                    .toolbar {
                        ToolbarItem(placement: .principal) {
                            Text(section?.title ?? "Strata")
                                .font(.mono(11))
                                .tracking(2)
                                .foregroundStyle(Strata.Tokens.paperDim)
                        }
                    }
            }
        }
        .frame(minWidth: 1000, minHeight: 640)
        .sheet(item: Binding(get: { activeWatch }, set: { activeWatch = $0 })) { req in
            WatchView(request: req)
                .frame(minWidth: 960, minHeight: 540)
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
            path.append(route)
        }
        services.coordinator.pendingRoute = nil
    }

    @ViewBuilder
    private var root: some View {
        switch section ?? .home {
        case .home: HomeView(path: $path)
        case .movies: MoviesView(path: $path)
        case .shows: ShowsView(path: $path)
        case .search: SearchView(path: $path)
        }
    }
}
#endif
