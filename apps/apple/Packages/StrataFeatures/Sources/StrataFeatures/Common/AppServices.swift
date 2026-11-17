import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI
#if os(tvOS)
import TVServices
#endif

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

    /// Keeps the Apple TV's Top Shelf showing this person's Continue Watching and Up Next
    /// (Home's rows, as just loaded). Elsewhere it does nothing.
    public func updateTopShelf(_ shelves: [Shelf]) {
        #if os(tvOS)
        guard let signIn = store.active?.id else { return }
        var items = TopShelf.items(from: shelves)
        // Art already made for an item keeps showing (no flash back to the plain image).
        let kept = Set(TopShelf.load()?.items.compactMap(\.artworkFile) ?? [])
        for i in items.indices {
            if let name = TopShelf.artworkName(for: items[i]), kept.contains(name) { items[i].artworkFile = name }
        }
        if TopShelf.save(TopShelfSnapshot(signIn: signIn, items: items)) {
            TVTopShelfContentProvider.topShelfContentDidChange()
        }
        // Then the logos are laid on the art, in the background; the shelf updates once done.
        topShelfArt?.cancel()
        topShelfArt = Task { [items] in
            let made = await TopShelfArtwork.make(for: items)
            guard !Task.isCancelled, made != items, self.store.active?.id == signIn else { return }
            if TopShelf.save(TopShelfSnapshot(signIn: signIn, items: made)) {
                TVTopShelfContentProvider.topShelfContentDidChange()
            }
        }
        #endif
    }

    #if os(tvOS)
    @ObservationIgnored private var topShelfArt: Task<Void, Never>?
    #endif

    /// Signed out, or someone else is watching now: the Top Shelf stops showing the last
    /// person's titles (it goes back to the app's own image until Home loads theirs).
    public func syncTopShelfOwner() {
        #if os(tvOS)
        guard let snapshot = TopShelf.load(), snapshot.signIn != store.active?.id else { return }
        if TopShelf.clear() { TVTopShelfContentProvider.topShelfContentDidChange() }
        #endif
    }

    /// Plays a Top Shelf item (the remote's Play button on it), if it's this person's;
    /// otherwise opens its page.
    public func playFromTopShelf(_ item: TopShelfSnapshot.Item) {
        guard let ref = TitleRef(string: item.ref) else { return }
        guard let snapshot = TopShelf.load(), snapshot.signIn == store.active?.id, snapshot.items.contains(item) else {
            coordinator.pendingRoute = .title(ref)
            return
        }
        let target: PlaybackTarget
        if let season = item.season, let episode = item.episode {
            target = .episode(show: ref, season: season, episode: episode)
        } else {
            target = .movie(ref)
        }
        play(WatchRequest(target: target, meta: PlaybackMeta(title: item.title, subtitle: item.subtitle, artworkURL: item.imageURL)))
    }

    /// Plays what Play chose for a title, with its title, logo and artwork in the player.
    public func play(_ choice: PlayChoice, title: String, artworkURL: URL?, logoURL: URL? = nil, startMs: Int? = nil) {
        play(WatchRequest(target: choice.target, meta: PlaybackMeta(title: title, subtitle: choice.subtitle, artworkURL: artworkURL, logoURL: logoURL),
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

    /// The sources with the server's filters for them; nil when they couldn't be loaded.
    public func sourceList(for target: PlaybackTarget, discover: Bool, refresh: Bool = false) async -> SourceList? {
        await load { try await $0.sourceList(target, discover: discover, refresh: refresh) }.value
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
    /// A row in full, from the server: the path its shelf names and its title.
    case rowList(String, String)
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
                            meta: PlaybackMeta(title: title, subtitle: subtitle, artworkURL: episode?.stillUrl ?? backdropUrl ?? posterUrl, logoURL: logoUrl),
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

/// A password-reset link from the email "Forgot password?" sends:
/// `strata://reset-password?server=<address>&token=<token>` (the web page the email's
/// link lands on opens it), or the links themselves pasted as text
/// (`https://<server>/reset-password?token=<token>`, or the email's
/// `https://<server>/api/auth/reset-password/<token>`).
public struct ResetPasswordRequest: Identifiable, Hashable {
    public let server: URL
    public let token: String
    public var id: String { token }

    public init?(_ url: URL) {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 } }
        switch url.scheme?.lowercased() {
        case "strata" where url.host == "reset-password":
            // No user@ part: the address shown must be the one the password goes to.
            guard let token = value("token"), let server = value("server").flatMap(URL.init(string:)),
                  server.scheme == "http" || server.scheme == "https", server.host != nil,
                  server.user == nil, server.password == nil else { return nil }
            self.server = server
            self.token = token
        case "http", "https":
            guard url.user == nil, url.password == nil else { return nil }
            let parts = url.pathComponents.filter { $0 != "/" }
            let token: String
            if parts == ["reset-password"], let found = value("token") {
                token = found
            } else if parts.count == 4, Array(parts.prefix(3)) == ["api", "auth", "reset-password"], !parts[3].isEmpty {
                token = parts[3]
            } else {
                return nil
            }
            guard var origin = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
            origin.path = ""
            origin.query = nil
            origin.fragment = nil
            guard let server = origin.url else { return nil }
            self.server = server
            self.token = token
        default:
            return nil
        }
    }
}

/// An invitation to a household: its QR code in the dashboard
/// (`strata://invite?server=<address>&id=<id>`), or the link passed on as text
/// (`https://<server>/invite/<id>`, whose page opens the app).
public struct InviteRequest: Identifiable, Hashable {
    public let server: URL
    public let invitationId: String
    public var id: String { invitationId }

    public init?(_ url: URL) {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let named: URL?
        let id: String?
        switch url.scheme?.lowercased() {
        case "strata" where url.host == "invite":
            named = query.first(where: { $0.name == "server" })?.value.flatMap(URL.init(string:))
            id = query.first(where: { $0.name == "id" })?.value
        case "http", "https":
            let parts = url.pathComponents.filter { $0 != "/" }
            guard parts.count == 2, parts[0] == "invite" else { return nil }
            named = url
            id = parts[1]
        default:
            return nil
        }
        guard let id, !id.isEmpty, let named, let server = Self.origin(named) else { return nil }
        self.server = server
        self.invitationId = id
    }

    /// Only the scheme, host and port of the server a link names. A link with a user or
    /// password in its address ("https://my.server@elsewhere.example") is refused: it's
    /// only ever used to make one address look like another.
    static func origin(_ url: URL) -> URL? {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil else { return nil }
        parts.scheme = scheme
        parts.host = host.lowercased()
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }
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
/// `strata://play/<ref>[/<season>/<episode>]` (the Apple TV's Top Shelf Play button: plays
/// only an item on this person's Top Shelf now; any other opens the title's page),
/// `strata://link?user_code=<code>&server=<id or address>` (approve a TV's sign-in),
/// `strata://sign-in?server=<address>&code=<code>` (a member's QR code: sign in as them),
/// `strata://reset-password?server=<address>&token=<token>` (a password-reset email's
/// link: choose a new password),
/// `strata://invite?server=<address>&id=<id>` (an invitation: join its household),
/// `strata://tv-link?key=<key>` (a TV with no server yet: send it this phone's), and
/// the TV's own `https://<server>/link?user_code=<code>` when it opens the app.
@MainActor
@Observable
public final class AppCoordinator {
    public var pendingRoute: Route?
    /// A Top Shelf item to play (`strata://play/…`), once someone is signed in.
    public var pendingPlay: TopShelfSnapshot.Item?
    public var pendingLink: LinkRequest?
    public var pendingSignIn: SignInCodeRequest?
    public var pendingTVLink: TVLinkRequest?
    public var pendingReset: ResetPasswordRequest?
    public var pendingInvite: InviteRequest?

    public init() {}

    public func handle(url: URL) {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        if let reset = ResetPasswordRequest(url) {
            pendingReset = reset
            return
        }
        // The QR code on the TV is the server's own page; opened in the app, the server is
        // the link's origin.
        if let invite = InviteRequest(url) {
            pendingInvite = invite
            return
        }
        if url.scheme == "http" || url.scheme == "https" {
            guard url.path == "/link", let code = value("user_code") else { return }
            link(code, server: url.absoluteString)
            return
        }
        guard url.scheme == "strata" else { return }
        let parts = url.pathComponents.dropFirst().compactMap { Int($0) }
        switch url.host {
        case "title":
            if let text = url.pathComponents.dropFirst().first, let ref = TitleRef(string: text) { pendingRoute = .title(ref) }
        case "movie": if let id = parts.first { pendingRoute = .title(.tmdb(.movie, id)) }
        case "show": if let id = parts.first { pendingRoute = .title(.tmdb(.show, id)) }
        case "watch":
            let kind = url.pathComponents.dropFirst().first
            if kind == "movie", let id = parts.first { pendingRoute = .title(.tmdb(.movie, id)) }
            if kind == "episode", parts.count == 3 { pendingRoute = .title(.tmdb(.show, parts[0])) }
        case "play":
            // Only what's on the Top Shelf now plays from a link; anything else opens its page.
            if let item = TopShelf.playable(url, in: TopShelf.load()) {
                pendingPlay = item
            } else if let text = url.pathComponents.dropFirst().first, let ref = TitleRef(string: text) {
                pendingRoute = .title(ref)
            }
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
