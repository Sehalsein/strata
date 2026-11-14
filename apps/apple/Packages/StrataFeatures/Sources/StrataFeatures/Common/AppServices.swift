import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

/// App-wide state: the server store, LAN discovery, the shared player, and
/// navigation requests that come from outside a screen (deep links, Up Next).
@MainActor
@Observable
public final class AppServices {
    public let store: ServerStore
    public let browser = ServerBrowser()
    public let engine = PlayerEngine()
    public let coordinator = AppCoordinator()
    private let nowPlaying = NowPlayingBridge()

    /// What Play does for a title, and changes to My List, watched and Continue Watching.
    public let titles: TitleActions

    /// What the full-screen player is showing, if anything.
    public var watching: WatchRequest?
    /// Bumped on every `titles` change (and after playback stops and its final position
    /// is saved), so screens showing lists and progress (Home, Resume buttons) can reload.
    public private(set) var progressRevision = 0

    /// Whether the device has a network connection. Offline, the app shows downloads.
    public private(set) var isOnline = NetworkConditions.shared.isOnline

    public init(store: ServerStore? = nil) {
        DeviceInfo.captureName()
        let store = store ?? ServerStore()
        self.store = store
        titles = TitleActions(client: { @MainActor [weak store] in store?.client },
                              recover: { @MainActor [weak store] error in await store?.recover(from: error) ?? false })
        RemoteCommandBridge.shared.attach(engine)
        #if os(iOS)
        DownloadStore.shared.clientFor = { [weak self] id in self?.store.client(forSignIn: id) }
        #endif
        engine.onProgress = { [weak self] target, ms, _ in self?.rememberOfflinePosition(target, ms: ms) }
        engine.onUndeliveredProgress = { [weak self] target, ms, duration in
            Task { @MainActor [weak self] in
                guard let id = self?.store.activeID else { return }
                await ProgressQueue.shared.enqueue(signInID: id, target: target, positionMs: ms, durationMs: duration)
            }
        }
        NetworkConditions.shared.onReachabilityChange { [weak self] online in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isOnline = online
                if online { await self.sendQueuedProgress() }
            }
        }
        Task { [weak self, changes = titles.changes] in
            for await change in changes { await self?.titleChanged(change) }
        }
    }

    private func titleChanged(_ change: TitleChange) async {
        progressRevision += 1
        // Its episodes join (or leave) the calendar and its notifications.
        if change.changesCalendar { await refreshEpisodeAlerts() }
    }

    /// Sends watch progress kept while offline, for the profile in use.
    public func sendQueuedProgress() async {
        guard let client = store.client, let id = store.activeID else { return }
        await ProgressQueue.shared.flush(client: client, signInID: id)
    }

    /// A downloaded title keeps where it was left (it plays without the server).
    private func rememberOfflinePosition(_ target: PlaybackTarget, ms: Int) {
        #if os(iOS)
        guard engine.session?.isOffline == true, let item = DownloadStore.shared.item(signInID: store.activeID, target: target) else { return }
        DownloadStore.shared.setPosition(item, ms: ms)
        #endif
    }

    /// The active server's client. Screens read it through here so a server
    /// switch is picked up everywhere.
    public var client: StrataClient? { store.client }

    /// Re-points the player at the active server. Call after sign-in or a switch.
    public func refreshClient() {
        if let client = store.client { engine.configure(client: client, nowPlaying: nowPlaying) }
        Task { await sendQueuedProgress() }
    }

    public func play(_ request: WatchRequest) {
        watching = request
    }

    /// Plays what Play chose for a title, with its title and artwork in the player.
    public func play(_ choice: PlayChoice, title: String, artworkURL: URL?, startMs: Int? = nil) {
        play(WatchRequest(target: choice.target, meta: PlaybackMeta(title: title, subtitle: choice.subtitle, artworkURL: artworkURL),
                          candidateId: choice.candidateId, startMs: startMs))
    }

    /// Runs a request and turns failures into a readable message, letting the
    /// store fail over to another address, sign out on 401, or ask for a household (409).
    public func load<T>(_ work: (StrataClient) async throws -> T) async -> Loadable<T> {
        guard let client = store.client else { return .failed(String(localized: "Not connected to a server.", bundle: .module)) }
        do {
            return .loaded(try await work(client))
        } catch is CancellationError {
            return .loading
        } catch {
            if await store.recover(from: error), let retry = store.client {
                if let value = try? await work(retry) { return .loaded(value) }
            }
            return .failed(StrataError.wrap(error).message)
        }
    }

    /// Stale-while-revalidate: hands `show` what this device kept, however old, at once,
    /// then the server's answer when the kept one is stale or missing (each catalog answer
    /// says how long it stays fresh). A failed refresh leaves the kept answer up, unless the
    /// server turned it down (the client then drops what it kept).
    /// `force` (pull to refresh) goes straight to the server.
    public func loadCached<T>(force: Bool = false, _ work: (StrataClient, CachePolicy) async throws -> T,
                              show: (Loadable<T>) -> Void) async {
        var showingKept = false
        if !force, let client, let kept = try? await work(client, .cachedOnly) {
            show(.loaded(kept))
            showingKept = true
        }
        let result = await load { try await work($0, force ? .reload : .fresh) }
        switch result {
        case .loading: return
        case .failed where showingKept:
            if let client, (try? await work(client, .cachedOnly)) != nil { return }
            show(result)
        default: show(result)
        }
    }

    /// What the server can play a title from. `discover` lets it look beyond its library where
    /// it's set up to (a few seconds, and calls whatever services it uses), so it's asked for
    /// only when the library alone can't answer. Empty when it has nothing (or the request
    /// fails): the app then offers nothing.
    public func sources(for target: PlaybackTarget, discover: Bool) async -> [Candidate] {
        await load { try await $0.sources(target, discover: discover) }.value ?? []
    }
}

public enum Loadable<T> {
    case loading
    case loaded(T)
    case failed(String)

    public var value: T? {
        if case .loaded(let v) = self { return v }
        return nil
    }
}

/// A request to open the player.
public struct WatchRequest: Identifiable, Hashable {
    public let target: PlaybackTarget
    public let meta: PlaybackMeta
    /// A source the server listed; nil lets the server choose.
    public let candidateId: String?
    /// nil resumes from the server's saved position (or, for a download, where it was left).
    public let startMs: Int?
    /// Plays this download (`DownloadItem.id`) from the device instead of streaming.
    public let downloadID: String?
    public let id = UUID()

    public init(target: PlaybackTarget, meta: PlaybackMeta, candidateId: String? = nil, startMs: Int? = nil, downloadID: String? = nil) {
        self.target = target
        self.meta = meta
        self.candidateId = candidateId
        self.startMs = startMs
        self.downloadID = downloadID
    }
}

public enum Route: Hashable {
    /// A movie's or a show's page, as its ref says.
    case title(TitleRef)
    case browse(TitleType, BrowseList)
    /// An Anime tab list in full: its id and title.
    case animeList(String, String)
    /// Every title of a shelf the server sent, past what its rail shows.
    case shelf(Shelf)
    case person(Int)
    case myList
    case calendar
}

public extension TitleCard {
    var route: Route { .title(ref) }
    var providerKinds: [ProviderKind] { available.kinds }

    /// For Continue Watching / Next Up cards.
    func watchRequest(restart: Bool = false) -> WatchRequest? {
        guard let target = playbackTarget else { return nil }
        let subtitle = episode.map { "\($0.code) · \($0.name)" } ?? yearText
        return WatchRequest(target: target,
                            meta: PlaybackMeta(title: title, subtitle: subtitle, artworkURL: episode?.stillUrl ?? backdropUrl ?? posterUrl),
                            startMs: restart ? 0 : nil)
    }
}

public extension Array where Element == Provider {
    var kinds: [ProviderKind] { isEmpty ? [] : [.library] }
}

/// A member's sign-in QR code (shown in the server's dashboard), opened as
/// `strata://sign-in?server=<address>&code=<code>`.
public struct SignInCodeRequest: Identifiable, Hashable {
    public let server: URL
    public let code: String
    public var id: String { code }
}

/// A TV's sign-in code to approve, from a scanned QR code or typed in Settings.
public struct LinkRequest: Identifiable, Hashable {
    public let code: String
    /// The server the TV is signing in to, as the link named it (a server id or one of
    /// its addresses); nil means the active sign-in's. Only ever matched against servers
    /// this device is already signed in to.
    public let server: String?
    public var id: String { code }

    public init(code: String, server: String? = nil) {
        self.code = code
        self.server = server
    }
}

/// A TV's "Sign in with your phone" QR code (`strata://tv-link?key=…`): send that TV
/// this phone's server, then approve it.
public struct TVLinkRequest: Identifiable, Hashable {
    public let key: String
    public var id: String { key }
}

/// Handles `strata://` deep links:
/// `strata://title/<ref>` (like `strata://title/anilist:show:154587`), and for TMDB titles
/// `strata://movie/<id>`, `strata://show/<id>`,
/// `strata://watch/movie/<id>`, `strata://watch/episode/<show>/<season>/<episode>` (open the
/// title's page: a link never starts playback by itself),
/// `strata://link?user_code=<code>&server=<id or address>` (approve a TV's sign-in),
/// `strata://sign-in?server=<address>&code=<code>` (a member's QR code: sign in as them),
/// `strata://tv-link?key=<key>` (a TV with no server yet: send it this phone's), and
/// the TV's own `https://<server>/link?user_code=<code>` when it opens the app.
@MainActor
@Observable
public final class AppCoordinator {
    public var pendingRoute: Route?
    public var pendingLink: LinkRequest?
    public var pendingSignIn: SignInCodeRequest?
    public var pendingTVLink: TVLinkRequest?

    public init() {}

    public func handle(url: URL) {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        // The QR code on the TV is the server's own page; opened in the app, the server is
        // the link's origin.
        if url.scheme == "http" || url.scheme == "https" {
            guard url.path == "/link", let code = value("user_code") else { return }
            link(code, server: url.absoluteString)
            return
        }
        guard url.scheme == "strata" else { return }
        let parts = url.pathComponents.dropFirst().compactMap { Int($0) }
        switch url.host {
        case "title":
            if let text = url.pathComponents.dropFirst().first, let ref = TitleRef(string: text), ref.isSupported { pendingRoute = .title(ref) }
        case "movie": if let id = parts.first { pendingRoute = .title(.tmdb(.movie, id)) }
        case "show": if let id = parts.first { pendingRoute = .title(.tmdb(.show, id)) }
        case "watch":
            let kind = url.pathComponents.dropFirst().first
            if kind == "movie", let id = parts.first { pendingRoute = .title(.tmdb(.movie, id)) }
            if kind == "episode", parts.count == 3 { pendingRoute = .title(.tmdb(.show, parts[0])) }
        case "tv-link":
            if let key = TVLink.key(in: url) { pendingTVLink = TVLinkRequest(key: key) }
        case "link":
            if let code = value("user_code") ?? value("code") { link(code, server: value("server")) }
        case "sign-in":
            if let code = value("code"), !code.isEmpty, let server = value("server").flatMap(URL.init(string:)),
               server.scheme == "http" || server.scheme == "https", server.host != nil {
                pendingSignIn = SignInCodeRequest(server: server, code: code)
            }
        default: break
        }
    }

    private func link(_ code: String, server: String?) {
        let code = DeviceCode.normalize(code)
        guard !code.isEmpty else { return }
        pendingLink = LinkRequest(code: code, server: server)
    }

    public func consume() -> Route? {
        defer { pendingRoute = nil }
        return pendingRoute
    }
}
