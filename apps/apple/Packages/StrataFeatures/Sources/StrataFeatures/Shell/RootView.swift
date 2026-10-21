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
        #if os(tvOS)
        // Focused tvOS controls turn white; an apricot label on white doesn't read,
        // so tvOS keeps the system's own focus colors.
        .preferredColorScheme(.dark)
        #else
        .tint(Theme.accentText)
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
        #if os(iOS)
        // A TV's QR code was scanned: confirm and approve its sign-in.
        .sheet(item: Binding(get: { services.coordinator.pendingLink }, set: { services.coordinator.pendingLink = $0 })) { request in
            ApproveDeviceView(request: request)
        }
        #endif
    }
}

enum AppTab: String, Hashable { case home, movies, shows, anime, search, profile }

/// The signed-in app: a floating Liquid Glass tab bar (iPhone), a sidebar
/// that adapts to a tab bar (iPad), or the top tab bar (tvOS).
struct MainShell: View {
    @Environment(AppServices.self) private var services
    @State private var tab: AppTab = Self.launchTab
    @State private var showSettings = Self.launchSettings

    /// DEBUG: `-StrataTab search` opens a tab and `-StrataSettings YES` the Settings
    /// sheet at launch, for screenshots and UI tests.
    private static var launchTab: AppTab {
        #if DEBUG
        UserDefaults.standard.string(forKey: "StrataTab").flatMap(AppTab.init(rawValue:)) ?? .home
        #else
        .home
        #endif
    }

    private static var launchSettings: Bool {
        #if DEBUG && os(iOS)
        UserDefaults.standard.bool(forKey: "StrataSettings")
        #else
        false
        #endif
    }

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
            Tab("Anime", image: "StrawHat", value: AppTab.anime) {
                StackHost { AnimeView() }
            }
            Tab(value: AppTab.search, role: .search) {
                StackHost { SearchView() }
            }
            #if os(tvOS)
            // tvOS has no toolbar for the avatar button, so the profile lives in the
            // tab bar like the TV app's: switching profiles, servers and sign-out.
            Tab(value: AppTab.profile) {
                SettingsView(embedded: true)
            } label: {
                Label(services.store.active?.profileName ?? "Profile", systemImage: "person.crop.circle")
            }
            #endif
        }
        #if os(iOS)
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        // Not on tvOS: there the tint also colors focused labels, which sit on white.
        .tint(Theme.ink)
        .sheet(isPresented: $showSettings) { SettingsView() }
        #endif
    }
}

/// A navigation stack with the app's destinations and deep-link handling.
struct StackHost<Root: View>: View {
    @Environment(AppServices.self) private var services
    @State private var path: [Route] = []
    @ViewBuilder let root: () -> Root

    var body: some View {
        NavigationStack(path: $path) {
            root().routeDestinations()
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

extension View {
    /// The app's navigation destinations, for any stack that pushes a `Route`.
    func routeDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .movie(let id): MovieDetailView(tmdbId: id)
            case .show(let id): ShowDetailView(tmdbId: id)
            case .browse(let type, let list): BrowseListView(type: type, list: list)
            case .person(let id): PersonView(personId: id)
            case .myList: MyListView()
            }
        }
    }
}
