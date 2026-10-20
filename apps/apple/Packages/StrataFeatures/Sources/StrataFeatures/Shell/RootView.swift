import SwiftUI
import StrataKit
import StrataDesign

/// Chooses between connecting, picking a profile, and the main app.
public struct RootView: View {
    @Environment(AppServices.self) private var services
    @State private var didConnect = false

    public init() {}

    public var body: some View {
        Group {
            if !services.store.isSignedIn {
                ConnectView()
            } else if services.store.needsProfileSelection || services.store.active?.hasProfile == false {
                ProfilePickerView()
            } else {
                MainShell()
                    .id(services.store.activeID.map { "\($0)-\(services.store.active?.profileId ?? 0)" })
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .tint(Theme.accentText)
        #if os(tvOS)
        .preferredColorScheme(.dark)
        #endif
        .task {
            guard !didConnect else { return }
            didConnect = true
            _ = await services.store.connect()
            services.refreshClient()
        }
        .onChange(of: services.store.activeID) { services.refreshClient() }
        .onChange(of: services.coordinator.pendingWatch) { _, target in
            guard let target, services.store.isSignedIn else { return }
            services.coordinator.pendingWatch = nil
            Task { await services.play(target) }
        }
        .fullScreenCover(item: Binding(get: { services.watching }, set: { services.watching = $0 })) { request in
            WatchView(request: request)
        }
    }
}

enum AppTab: Hashable { case home, movies, shows, myList, search }

/// The signed-in app: a floating Liquid Glass tab bar (iPhone), a sidebar
/// that adapts to a tab bar (iPad), or the top tab bar (tvOS).
struct MainShell: View {
    @Environment(AppServices.self) private var services
    @State private var tab: AppTab = .home

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                StackHost { HomeView() }
            }
            Tab("Movies", systemImage: "film", value: AppTab.movies) {
                StackHost { BrowseView(type: .movie) }
            }
            Tab("Shows", systemImage: "tv", value: AppTab.shows) {
                StackHost { BrowseView(type: .show) }
            }
            #if os(tvOS)
            Tab("My List", systemImage: "bookmark", value: AppTab.myList) {
                StackHost { MyListView() }
            }
            #else
            Tab("My List", systemImage: "bookmark", value: AppTab.myList) {
                StackHost { MyListView() }
            }
            #endif
            Tab(value: AppTab.search, role: .search) {
                StackHost { SearchView() }
            }
        }
        #if os(iOS)
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        #endif
        .tint(Theme.ink)
    }
}

/// A navigation stack with the app's destinations and deep-link handling.
struct StackHost<Root: View>: View {
    @Environment(AppServices.self) private var services
    @State private var path: [Route] = []
    @ViewBuilder let root: () -> Root

    var body: some View {
        NavigationStack(path: $path) {
            root()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .movie(let id): MovieDetailView(tmdbId: id)
                    case .show(let id): ShowDetailView(tmdbId: id)
                    case .browse(let type, let list): BrowseListView(type: type, list: list)
                    }
                }
        }
        .onChange(of: services.coordinator.pendingRoute) { _, route in
            if route != nil, let next = services.coordinator.consume() { path.append(next) }
        }
    }
}

/// Avatar button that opens Settings, for the navigation bar.
struct ProfileToolbarButton: View {
    @Environment(AppServices.self) private var services
    @State private var showSettings = false

    var body: some View {
        Button {
            showSettings = true
        } label: {
            ProfileAvatar(name: services.store.active?.profileName ?? "?", seed: "\(services.store.active?.profileId ?? 0)", size: 30)
        }
        .accessibilityLabel("Settings")
        .sheet(isPresented: $showSettings) { SettingsView() }
    }
}
