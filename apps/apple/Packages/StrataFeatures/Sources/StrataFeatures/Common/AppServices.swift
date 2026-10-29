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

    /// What the full-screen player is showing, if anything.
    public var watching: WatchRequest?
    /// Bumped after playback stops and its final position is saved, so screens
    /// showing progress (Continue Watching, Resume buttons) can reload.
    public private(set) var progressRevision = 0

    public func progressChanged() async {
        await client?.clearCache()
        progressRevision += 1
    }

    public init(store: ServerStore? = nil) {
        self.store = store ?? ServerStore()
        RemoteCommandBridge.shared.attach(engine)
    }

    /// The active server's client. Screens read it through here so a server
    /// switch is picked up everywhere.
    public var client: StrataClient? { store.client }

    /// Re-points the player at the active server. Call after sign-in or a switch.
    public func refreshClient() {
        if let client = store.client { engine.configure(client: client, nowPlaying: nowPlaying) }
    }

    public func play(_ request: WatchRequest) {
        watching = request
    }

    /// Plays a deep-linked target, looking up its title for the player first.
    public func play(_ target: PlaybackTarget) async {
        var meta = PlaybackMeta(title: "Strata")
        if target.mediaType == .movie, let movie = await load({ try await $0.movie(target.tmdbId) }).value {
            meta = PlaybackMeta(title: movie.title, subtitle: movie.yearText, artworkURL: movie.backdropUrl)
        } else if let show = await load({ try await $0.show(target.tmdbId) }).value {
            meta = PlaybackMeta(title: show.title, subtitle: "S\(target.season ?? 1) · E\(target.episode ?? 1)", artworkURL: show.backdropUrl)
        }
        play(WatchRequest(target: target, meta: meta))
    }

    /// Runs a request and turns failures into a readable message, letting the
    /// store fail over to another address, sign out on 401, or ask for a profile.
    public func load<T>(_ work: (StrataClient) async throws -> T) async -> Loadable<T> {
        guard let client = store.client else { return .failed("Not connected to a server.") }
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
    /// nil resumes from the server's saved position.
    public let startMs: Int?
    public let id = UUID()

    public init(target: PlaybackTarget, meta: PlaybackMeta, candidateId: String? = nil, startMs: Int? = nil) {
        self.target = target
        self.meta = meta
        self.candidateId = candidateId
        self.startMs = startMs
    }
}

public enum Route: Hashable {
    case movie(Int)
    case show(Int)
    case browse(TitleType, BrowseList)
    case person(Int)
    case myList
    case calendar
}

public extension TitleCard {
    var route: Route { type == .movie ? .movie(tmdbId) : .show(tmdbId) }
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

/// A TV's sign-in code to approve, from a scanned QR code or typed in Settings.
public struct LinkRequest: Identifiable, Hashable {
    public let code: String
    /// The server the TV is signing in to; nil means the active one.
    public let serverID: String?
    public var id: String { code }
}

/// Handles `strata://` deep links:
/// `strata://movie/<id>`, `strata://show/<id>`,
/// `strata://watch/movie/<id>`, `strata://watch/episode/<show>/<season>/<episode>`,
/// `strata://link?code=<code>&server=<id>` (approve a TV's sign-in).
@MainActor
@Observable
public final class AppCoordinator {
    public var pendingRoute: Route?
    public var pendingWatch: PlaybackTarget?
    public var pendingLink: LinkRequest?

    public init() {}

    public func handle(url: URL) {
        guard url.scheme == "strata" else { return }
        let parts = url.pathComponents.dropFirst().compactMap { Int($0) }
        switch url.host {
        case "movie": if let id = parts.first { pendingRoute = .movie(id) }
        case "show": if let id = parts.first { pendingRoute = .show(id) }
        case "watch":
            let kind = url.pathComponents.dropFirst().first
            if kind == "movie", let id = parts.first { pendingWatch = .movie(id) }
            if kind == "episode", parts.count == 3 { pendingWatch = .episode(show: parts[0], season: parts[1], episode: parts[2]) }
        case "link":
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
            if let code = value("code"), !DeviceLink.normalize(code).isEmpty {
                pendingLink = LinkRequest(code: DeviceLink.normalize(code), serverID: value("server"))
            }
        default: break
        }
    }

    public func consume() -> Route? {
        defer { pendingRoute = nil }
        return pendingRoute
    }
}
