import SwiftUI
import StrataKit
import StrataDesign

/// Chooses between connecting, "Who's watching?", picking a library, and the main app.
public struct RootView: View {
    @Environment(AppServices.self) private var services

    public init() {}

    /// With no connection, the profile's downloads (when it has some) instead of pages
    /// that can't load.
    private var showsOfflineDownloads: Bool {
        #if os(iOS)
        !services.isOnline && DownloadStore.shared.items(for: services.store.activeID).contains(where: \.isDone)
        #else
        false
        #endif
    }

    public var body: some View {
        Group {
            if services.store.signIns.isEmpty {
                ConnectView()
            } else if showsOfflineDownloads {
                #if os(iOS)
                OfflineDownloadsView()
                #endif
            } else if !services.store.isSignedIn {
                WhoIsWatchingView()
            } else if services.store.active?.mustChangePassword == true {
                ChooseNewPasswordView()
            } else if services.store.needsHousehold {
                HouseholdPickerView()
            } else {
                // A new account or household starts the app afresh: nothing from the last
                // one's screens or caches carries over.
                MainShell()
                    .id("\(services.store.activeID ?? "")/\(services.store.active?.household?.id ?? "")")
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
        // At launch and on every switch: find the server, check the session is still good
        // and refresh the account and household.
        .task(id: services.store.activeID) {
            guard services.store.activeID != nil else { return }
            _ = await services.store.connect()
            services.refreshClient()
        }
        .onChange(of: services.store.activeID) { services.refreshClient() }
        .fullScreenCover(item: Binding(get: { services.watching }, set: { services.watching = $0 })) { request in
            WatchView(request: request)
        }
        // A member's sign-in QR code was scanned: confirm, then sign in as them.
        .sheet(item: Binding(get: { services.coordinator.pendingSignIn }, set: { services.coordinator.pendingSignIn = $0 })) { request in
            SignInCodeView(request: request)
        }
        #if os(iOS)
        // A TV's sign-in link was opened: confirm and approve it.
        .sheet(item: Binding(get: { services.store.signIns.isEmpty ? nil : services.coordinator.pendingLink },
                             set: { services.coordinator.pendingLink = $0 })) { request in
            ApproveDeviceView(request: request)
        }
        #endif
    }
}

enum AppTab: String, Hashable { case home, movies, shows, anime, calendar, search, myList, downloads, profile }

/// The signed-in app: a floating Liquid Glass tab bar (iPhone), a sidebar
/// that adapts to a tab bar (iPad), or the top tab bar (tvOS).
struct MainShell: View {
    @Environment(AppServices.self) private var services
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab: AppTab = Self.launchTab
    @State private var showSettings = Self.launchSettings
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    /// Whether the iPad sidebar (with My List, Downloads and the profile) is showing. Not
    /// in a narrow window (Split View, Slide Over), where it collapses to the tab bar.
    private var showsSidebar: Bool {
        #if os(iOS)
        Self.sidebar && sizeClass != .compact
        #else
        false
        #endif
    }

    /// DEBUG: `-StrataTab search` opens a tab and `-StrataSettings YES` the Settings
    /// sheet at launch, for screenshots and UI tests.
    private static var launchTab: AppTab {
        #if DEBUG
        UserDefaults.standard.string(forKey: "StrataTab").flatMap(AppTab.init(rawValue:)) ?? .home
        #else
        .home
        #endif
    }

    /// iPad's sidebar also lists My List, Calendar and the profile, like the TV app's
    /// Library and account; the tab bar keeps the same five tabs as iPhone.
    private static var sidebar: Bool {
        #if os(iOS)
        Metrics.isPad
        #else
        false
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
                StackHost(tab: .home) { HomeView() }
            }
            Tab("Movies", systemImage: "film", value: AppTab.movies) {
                StackHost(tab: .movies) { BrowseView(type: .movie) }
            }
            Tab("Shows", systemImage: "tv", value: AppTab.shows) {
                StackHost(tab: .shows) { BrowseView(type: .show) }
            }
            Tab("Anime", image: "StrawHat", value: AppTab.anime) {
                StackHost(tab: .anime) { AnimeView() }
            }
            #if os(tvOS)
            // The TV's top tab bar has room for it; iPhone and iPad reach it from Home's
            // Coming Up rail (and iPad's sidebar).
            Tab("Calendar", systemImage: "calendar", value: AppTab.calendar) {
                StackHost(tab: .calendar) { CalendarView() }
            }
            #endif
            Tab(value: AppTab.search, role: .search) {
                SearchTab()
            }
            #if os(iOS)
            if Self.sidebar {
                TabSection("Library") {
                    Tab("My List", systemImage: "bookmark", value: AppTab.myList) {
                        StackHost(tab: .myList) { MyListView() }
                    }
                    Tab("Calendar", systemImage: "calendar", value: AppTab.calendar) {
                        StackHost(tab: .calendar) { CalendarView() }
                    }
                    Tab("Downloads", systemImage: "arrow.down.circle", value: AppTab.downloads) {
                        StackHost(tab: .downloads) { DownloadsView() }
                    }
                }
                .tabPlacement(.sidebarOnly)
                Tab(value: AppTab.profile) {
                    SettingsView(embedded: true)
                } label: {
                    Label(services.store.active?.name ?? "Profile", systemImage: "person.crop.circle")
                }
                .tabPlacement(.sidebarOnly)
            }
            #endif
            #if os(tvOS)
            // tvOS has no toolbar for the avatar button, so the account lives in the
            // tab bar like the TV app's: switching accounts, households and sign-out.
            Tab(value: AppTab.profile) {
                SettingsView(embedded: true)
            } label: {
                Label(services.store.active?.name ?? "Profile", systemImage: "person.crop.circle")
            }
            #endif
        }
        #if os(iOS)
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        // Pages put My List, Downloads and the profile in their toolbars when there's no sidebar.
        .environment(\.showsSidebar, showsSidebar)
        // A sidebar-only tab can't stay selected once the window narrows to a tab bar.
        .onChange(of: showsSidebar) { _, shown in
            if !shown, [.myList, .calendar, .downloads, .profile].contains(tab) { tab = .home }
        }
        // Not on tvOS: there the tint also colors focused labels, which sit on white.
        .tint(Theme.ink)
        .sheet(isPresented: $showSettings) { SettingsView() }
        #endif
        .environment(\.selectedTab, tab)
        // A link (strata://movie/…, a notification) opens in the tab on screen, or Home
        // when that tab has no stack to push onto (Search, the profile).
        .onChange(of: services.coordinator.pendingRoute) { _, route in
            if route != nil, [.search, .profile].contains(tab) { tab = .home }
        }
        // Episode notifications follow the calendar: on launch, account switches and return.
        .task(id: services.store.active.map { "\($0.id)/\($0.household?.id ?? "")" }) { await services.refreshEpisodeAlerts() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await services.refreshEpisodeAlerts() } }
        }
    }
}

/// A navigation stack with the app's destinations and deep-link handling.
struct StackHost<Root: View>: View {
    @Environment(AppServices.self) private var services
    @Environment(\.selectedTab) private var selectedTab
    @State private var path: [Route] = []
    /// The tab this stack is in: only the selected tab's stack takes a pending link.
    let tab: AppTab
    @ViewBuilder let root: () -> Root

    var body: some View {
        NavigationStack(path: $path) {
            root().routeDestinations()
        }
        // A second tap while the page is pushing doesn't push it twice.
        .environment(\.pushRoute, PushRouteAction { route in if path.last != route { path.append(route) } })
        .onChange(of: services.coordinator.pendingRoute) { openPending() }
        .onChange(of: selectedTab) { openPending() }
        // A link opened before this screen existed (from "Who's watching?" or sign-in).
        .onAppear { openPending() }
    }

    private func openPending() {
        guard selectedTab == tab, services.coordinator.pendingRoute != nil, let next = services.coordinator.consume() else { return }
        if path.last != next { path.append(next) }
    }
}

/// Pushes a page onto the enclosing `StackHost`'s stack, for taps that aren't a
/// NavigationLink (the Home hero's artwork).
struct PushRouteAction {
    let push: @MainActor @Sendable (Route) -> Void
    @MainActor func callAsFunction(_ route: Route) { push(route) }
}

extension EnvironmentValues {
    @Entry var pushRoute = PushRouteAction { _ in }
    /// The iPad sidebar is showing (it has My List, Downloads and the profile).
    @Entry var showsSidebar = false
    /// The main tab on screen, for `StackHost`.
    @Entry var selectedTab: AppTab = .home
}

#if !os(tvOS)
/// The avatar button, after a gap, at the end of a page's toolbar. Not on iPad,
/// where the profile is in the sidebar.
struct ProfileToolbarItems: ToolbarContent {
    @Environment(\.showsSidebar) private var showsSidebar

    var body: some ToolbarContent {
        if showsButton {
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) { ProfileToolbarButton() }
        }
    }

    private var showsButton: Bool { !showsSidebar }
}
#endif

/// Avatar button that opens Settings, for the navigation bar.
struct ProfileToolbarButton: View {
    @Environment(AppServices.self) private var services
    @State private var showSettings = false

    var body: some View {
        Button {
            showSettings = true
        } label: {
            ProfileAvatar(name: services.store.active?.name ?? "?", seed: services.store.activeID ?? "", size: 30,
                          imageURL: services.store.active.flatMap(services.store.imageURL(for:)))
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
            case .calendar: CalendarView()
            }
        }
    }
}
