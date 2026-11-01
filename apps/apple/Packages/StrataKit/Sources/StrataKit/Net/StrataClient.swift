import Foundation
import CryptoKit

/// Async client for one Strata server. Cheap to create; immutable (`withToken` returns a copy).
///
/// Errors are always `StrataError`. Relative stream/subtitle URLs in responses are resolved
/// against `baseURL`, so `PlayResponse.url` and `SubtitleTrack.url` are ready for AVPlayer.
public final class StrataClient: Sendable {
    public let baseURL: URL
    public let token: String?
    private let session: URLSession
    private let cache: ResponseCache

    /// - Parameters:
    ///   - baseURL: `http(s)://host:port` (see `ServerAddress.normalize`).
    ///   - cacheTTL: how long a catalog answer stays fresh when the server doesn't say
    ///     (`Cache-Control: max-age`); 0 turns caching off.
    ///   - persistent: keeps catalog answers on disk too, so a cold launch paints at once.
    public init(baseURL: URL, token: String? = nil, session: URLSession = StrataNetworking.apiSession,
                cacheTTL: TimeInterval = 30, persistent: Bool = false) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.cache = ResponseCache(ttl: cacheTTL, directory: persistent && cacheTTL > 0 ? ResponseCache.directory(for: token) : nil)
    }

    private init(baseURL: URL, token: String?, session: URLSession, cache: ResponseCache) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.cache = cache
    }

    /// Same server and cache, different credentials.
    public func withToken(_ token: String?) -> StrataClient {
        StrataClient(baseURL: baseURL, token: token, session: session, cacheTTL: cache.ttl, persistent: cache.isPersistent)
    }

    /// Same token, different address (address fallback).
    public func withBaseURL(_ url: URL) -> StrataClient {
        StrataClient(baseURL: url, token: token, session: session, cache: cache)
    }

    /// Drops every cached answer, on disk too (sign-out, profile switch).
    public func clearCache() async { await cache.clear() }

    /// Server-relative URL → absolute.
    public func resolve(_ url: URL) -> URL { ServerAddress.resolve(url, against: baseURL) }

    // MARK: - Server & auth

    public func info() async throws -> ServerInfo {
        try await get("/api/info", cached: false)
    }

    public func isSetupRequired() async throws -> Bool {
        try await info().setupRequired
    }

    /// First-run only: creates the admin (and a first profile). Returns a token.
    public func setupAdmin(username: String, password: String, deviceName: String = DeviceInfo.deviceName) async throws -> String {
        let body = Credentials(username: username, password: password, deviceName: deviceName)
        let res: TokenResponse = try await send("POST", "/api/setup/admin", body: body)
        return res.token
    }

    /// Returns a bearer token. Use `withToken(_:)` to get an authenticated client.
    public func login(username: String, password: String, deviceName: String = DeviceInfo.deviceName) async throws -> String {
        let body = Credentials(username: username, password: password, deviceName: deviceName)
        let res: TokenResponse = try await send("POST", "/api/auth/login", body: body)
        return res.token
    }

    /// Joins from the home network without a password (only when `ServerInfo.localJoin`).
    /// The session can watch but not administer; profile PINs still apply.
    public func join(deviceName: String = DeviceInfo.deviceName) async throws -> String {
        let res: TokenResponse = try await send("POST", "/api/auth/join", body: DeviceNameBody(deviceName: deviceName))
        return res.token
    }

    // MARK: Sign-in by code (a TV shows a QR code; a signed-in phone approves it)

    /// Starts a code for this device. Unauthenticated: the device isn't signed in yet.
    public func startDeviceLink(deviceName: String = DeviceInfo.deviceName) async throws -> DeviceLink {
        try await send("POST", "/api/auth/device", body: DeviceNameBody(deviceName: deviceName))
    }

    public func pollDeviceLink(_ pollToken: String) async throws -> DeviceLinkPoll {
        try await send("POST", "/api/auth/device/poll", body: PollBody(pollToken: pollToken))
    }

    /// What a code would sign in, so the phone can ask before approving.
    public func pendingDeviceLink(code: String) async throws -> PendingDeviceLink {
        try await get("/api/auth/device/\(DeviceLink.normalize(code))", cached: false)
    }

    public func approveDeviceLink(code: String) async throws {
        let _: OKResponse = try await send("POST", "/api/auth/device/\(DeviceLink.normalize(code))/approve")
    }

    public func logout() async throws {
        let _: OKResponse = try await send("POST", "/api/auth/logout")
        await cache.clear()
    }

    public func me() async throws -> Me {
        try await get("/api/me", cached: false)
    }

    public func profiles() async throws -> [Profile] {
        try await get("/api/profiles", cached: false)
    }

    /// Binds this token to a profile. Throws 403 "Wrong PIN".
    public func selectProfile(id: Int, pin: String? = nil) async throws {
        let _: OKResponse = try await send("POST", "/api/profiles/\(id)/select", body: PinBody(pin: pin))
        await cache.clear()
    }

    // MARK: - Catalog

    /// Home in one answer (the hero, the profile's rails, then the catalog's). Not kept.
    public func home() async throws -> [Shelf] {
        let res: ShelvesResponse = try await get("/api/home", cached: false)
        return res.shelves
    }

    /// Home's rails that are the same for everyone: the hero, recently added, trending.
    /// A server from before Home came in parts answers with all of Home.
    public func homeCatalog(_ policy: CachePolicy = .fresh) async throws -> [Shelf] {
        do {
            let res: ShelvesResponse = try await get("/api/home/catalog", policy: policy)
            return res.shelves
        } catch let error as StrataError where error.isNotFound {
            return try await home()
        }
    }

    /// Continue Watching, Next Up and My List. Never kept here: they change as the profile
    /// watches (on any device), so the server keeps them until they do. Empty from a server
    /// from before Home came in parts (its `homeCatalog` has them).
    public func homeProfile() async throws -> [Shelf] {
        do {
            let res: ShelvesResponse = try await get("/api/home/profile", cached: false)
            return res.shelves
        } catch let error as StrataError where error.isNotFound {
            return []
        }
    }

    public func browse(_ type: TitleType, list: BrowseList, _ policy: CachePolicy = .fresh) async throws -> [TitleCard] {
        let res: ItemsResponse<TitleCard> = try await get("/api/browse/\(type.rawValue)/\(list.rawValue)", policy: policy)
        return res.items
    }

    /// TMDB genres for movies or shows, in the server's language.
    public func genres(_ type: TitleType, _ policy: CachePolicy = .fresh) async throws -> [Genre] {
        let res: ItemsResponse<Genre> = try await get("/api/genres/\(type.rawValue)", policy: policy)
        return res.items
    }

    /// Rails for one genre: In Your Library, New, Popular, Top Rated.
    public func genreShelves(_ type: TitleType, genreId: Int, _ policy: CachePolicy = .fresh) async throws -> [Shelf] {
        let res: ShelvesResponse = try await get("/api/browse/\(type.rawValue)/genre/\(genreId)", policy: policy)
        return res.shelves
    }

    public func animeCategories(_ policy: CachePolicy = .fresh) async throws -> [AnimeCategory] {
        let res: ItemsResponse<AnimeCategory> = try await get("/api/anime/categories", policy: policy)
        return res.items
    }

    /// The Anime tab's rails, for every category or just one.
    public func anime(category: String? = nil, _ policy: CachePolicy = .fresh) async throws -> [Shelf] {
        let res: ShelvesResponse = try await get("/api/anime", query: category.map { [URLQueryItem(name: "category", value: $0)] } ?? [], policy: policy)
        return res.shelves
    }

    /// Episodes of the shows on this profile's list: the last week and the next month.
    public func calendar(_ policy: CachePolicy = .fresh) async throws -> [CalendarEpisode] {
        let res: ItemsResponse<CalendarEpisode> = try await get("/api/calendar", policy: policy)
        return res.items
    }

    public func person(_ id: Int, _ policy: CachePolicy = .fresh) async throws -> PersonDetail {
        try await get("/api/person/\(id)", policy: policy)
    }

    public func search(_ query: String) async throws -> [TitleCard] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        let res: ItemsResponse<TitleCard> = try await get("/api/search", query: [URLQueryItem(name: "q", value: q)])
        return res.items
    }

    public func movie(_ tmdbId: Int, _ policy: CachePolicy = .fresh) async throws -> MovieDetail {
        try await get(Self.titlePath(.movie, tmdbId), policy: policy)
    }

    public func show(_ tmdbId: Int, _ policy: CachePolicy = .fresh) async throws -> ShowDetail {
        try await get(Self.titlePath(.show, tmdbId), policy: policy)
    }

    public func season(show tmdbId: Int, _ season: Int, _ policy: CachePolicy = .fresh) async throws -> SeasonDetail {
        try await get(Self.titlePath(.show, tmdbId) + "/seasons/\(season)", policy: policy)
    }

    static func titlePath(_ type: TitleType, _ tmdbId: Int) -> String { "/api/titles/\(type.rawValue)/\(tmdbId)" }

    /// What the server can play a title from. `discover` asks it to look further than its
    /// library where it's set up to (takes a few seconds); the list is whatever it returns.
    public func sources(_ target: PlaybackTarget, discover: Bool = false) async throws -> [Candidate] {
        var query = target.queryItems
        if discover { query.append(URLQueryItem(name: "discover", value: "1")) }
        let res: ItemsResponse<Candidate> = try await get("/api/sources", query: query, cached: false)
        return res.items
    }

    // MARK: - Playback

    /// Starts a playback session. `startMs` nil resumes from saved progress. Returns
    /// `.preparing` (HTTP 202) while the server gets the source ready; repeat to follow it.
    public func play(_ target: PlaybackTarget,
                     candidateId: String? = nil,
                     startMs: Int? = nil,
                     audioStreamIndex: Int? = nil,
                     caps: ClientCaps = .current) async throws -> PlayOutcome {
        let body = PlayBody(mediaType: target.mediaType, tmdbId: target.tmdbId, season: target.season, episode: target.episode,
                            candidateId: candidateId, startMs: startMs, audioStreamIndex: audioStreamIndex, caps: caps)
        let (data, response) = try await perform(request("POST", "/api/play", body: body))
        // 202: the server is getting the source ready; repeat the call to follow it.
        if response.statusCode == 202 {
            return .preparing(try decode(PreparingStatus.self, from: data))
        }
        var res = try decode(PlayResponse.self, from: data)
        res.url = resolve(res.url)
        for i in res.subtitleTracks.indices {
            res.subtitleTracks[i].url = res.subtitleTracks[i].url.map(resolve)
        }
        return .started(res)
    }

    /// Ends a session (stops its ffmpeg job). Best-effort callers can ignore errors.
    public func stopPlayback(sessionId: String) async throws {
        let _: OKResponse = try await send("DELETE", "/api/play/\(sessionId)")
    }

    @discardableResult
    public func reportProgress(_ target: PlaybackTarget, positionMs: Int, durationMs: Int, sessionId: String? = nil) async throws -> WatchProgress {
        let body = ProgressBody(mediaType: target.mediaType, tmdbId: target.tmdbId, season: target.season, episode: target.episode,
                                positionMs: max(0, positionMs), durationMs: max(0, durationMs), sessionId: sessionId)
        let res: WatchProgress = try await send("POST", "/api/progress", body: body)
        await cache.remove([Self.titlePath(target.titleType, target.tmdbId)])
        return res
    }

    public func setWatched(_ target: PlaybackTarget, _ watched: Bool) async throws {
        let body = WatchedBody(mediaType: target.mediaType, tmdbId: target.tmdbId, season: target.season, episode: target.episode, watched: watched)
        let _: OKResponse = try await send("POST", "/api/watched", body: body)
        await cache.remove([Self.titlePath(target.titleType, target.tmdbId)])
    }

    /// Takes a title off Continue Watching and Next Up (until it's watched again); its
    /// progress is kept.
    public func hideFromContinue(_ type: TitleType, tmdbId: Int) async throws {
        let _: OKResponse = try await send("DELETE", "/api/continue/\(type.rawValue)/\(tmdbId)")
    }

    public func setWatchlist(_ type: TitleType, tmdbId: Int, _ on: Bool) async throws {
        let _: OKResponse = try await send("PUT", "/api/watchlist", body: WatchlistBody(type: type, tmdbId: tmdbId, on: on))
        await cache.remove(["/api/calendar", Self.titlePath(type, tmdbId)])
    }

    /// Fetches a WebVTT track. The server extracts embedded tracks on demand and answers
    /// 202 while that runs; this retries with backoff (honouring Retry-After) until the
    /// text arrives, `maxWait` passes, or the task is cancelled.
    /// Whether `url` points at this client's server (scheme, host and port).
    public func isSameOrigin(_ url: URL) -> Bool { Self.sameOrigin(url, baseURL) }

    static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        func port(_ u: URL) -> Int? { u.port ?? (u.scheme?.lowercased() == "https" ? 443 : u.scheme?.lowercased() == "http" ? 80 : nil) }
        return a.scheme?.lowercased() == b.scheme?.lowercased()
            && a.host()?.lowercased() == b.host()?.lowercased()
            && port(a) == port(b)
    }

    public func subtitles(_ url: URL, maxWait: TimeInterval = 120) async throws -> String {
        let deadline = Date().addingTimeInterval(maxWait)
        var delay: TimeInterval = 1
        while true {
            let target = resolve(url)
            var req = URLRequest(url: target)
            req.setValue("text/vtt, */*", forHTTPHeaderField: "Accept")
            // Credentials only ever go to this server, never to a URL elsewhere.
            if let token, isSameOrigin(target) { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            let (data, response) = try await rawData(req)
            let status = response.statusCode
            if status == 202 {
                let retryAfter = response.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
                let wait = min(retryAfter ?? delay, 10)
                guard Date().addingTimeInterval(wait) < deadline else {
                    throw StrataError(kind: .http, status: 202, message: "Subtitles are still being prepared. Try again in a moment.")
                }
                try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                delay = min(delay * 2, 8)
                continue
            }
            guard (200..<300).contains(status) else { throw httpError(status, data) }
            return String(decoding: data, as: UTF8.self)
        }
    }

    // MARK: - Plumbing

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], cached: Bool = true, policy: CachePolicy = .fresh) async throws -> T {
        let req = try request("GET", path, query: query)
        guard cached, cache.ttl > 0 else { return try decode(T.self, from: try await perform(req).0) }
        let key = cacheKey(req)
        if policy != .reload, let hit = await cache.entry(key), policy == .cachedOnly || hit.isFresh {
            return try decode(T.self, from: hit.body)
        }
        if policy == .cachedOnly { throw StrataError(kind: .notCached, message: "Not saved on this device yet.") }
        // Screens appearing together often ask for the same thing: share one request.
        let task = await cache.shared(key) {
            let (data, response) = try await self.perform(req)
            return (data, ResponseCache.maxAge(response))
        }
        let result: (Data, TimeInterval?)
        do {
            result = try await task.value
        } catch {
            await cache.finished(key, task, result: nil)
            throw error
        }
        await cache.finished(key, task, result: result)
        return try decode(T.self, from: result.0)
    }

    private func send<T: Decodable>(_ method: String, _ path: String) async throws -> T {
        let (data, _) = try await perform(request(method, path))
        return try decode(T.self, from: data)
    }

    private func send<T: Decodable, B: Encodable>(_ method: String, _ path: String, body: B) async throws -> T {
        let (data, _) = try await perform(request(method, path, body: body))
        return try decode(T.self, from: data)
    }

    private func request(_ method: String, _ path: String, query: [URLQueryItem] = []) throws -> URLRequest {
        try request(method, path, query: query, body: Optional<Empty>.none)
    }

    private func request<B: Encodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], body: B?) throws -> URLRequest {
        guard var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw StrataError(kind: .invalidInput, message: "That doesn't look like a valid server address.")
        }
        comps.path = path
        comps.queryItems = query.isEmpty ? nil : query
        // URLComponents leaves "+" alone in queries; servers read it as a space.
        comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = comps.url else {
            throw StrataError(kind: .invalidInput, message: "That doesn't look like a valid server address.")
        }
        var req = URLRequest(url: url)
        // The client keeps catalog answers itself (`ResponseCache`); URLCache mustn't answer
        // in its place, or a pull-to-refresh would get the old answer back.
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return req
    }

    /// Returns body + response for 2xx; throws `StrataError` otherwise.
    private func perform(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await rawData(req)
        let status = response.statusCode
        guard (200..<300).contains(status) else { throw httpError(status, data) }
        return (data, response)
    }

    private func rawData(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: req, delegate: RedirectGuard(origin: baseURL))
            guard let http = response as? HTTPURLResponse else {
                throw StrataError(kind: .decoding, message: "The server sent an invalid response.")
            }
            return (data, http)
        } catch {
            throw StrataError.wrap(error, host: ServerAddress.display(baseURL))
        }
    }

    private func httpError(_ status: Int, _ data: Data) -> StrataError {
        let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        return StrataError.http(status, serverMessage: message)
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            Log.net.error("Decoding \(String(describing: T.self), privacy: .public) failed: \(String(describing: error), privacy: .public)")
            throw StrataError.wrap(error)
        }
    }

    /// Path and query only: the cache belongs to this token, and a fallback address of the
    /// same server (`withBaseURL`) shares it.
    private func cacheKey(_ req: URLRequest) -> String {
        guard let url = req.url else { return "" }
        return url.path + (url.query.map { "?" + $0 } ?? "")
    }
}

// MARK: - Bodies

private struct Empty: Encodable {}
private struct ErrorBody: Decodable { var error: String? }
private struct Credentials: Encodable { var username: String; var password: String; var deviceName: String }
private struct PinBody: Encodable { var pin: String? }
private struct DeviceNameBody: Encodable { var deviceName: String }
private struct PollBody: Encodable { var pollToken: String }
private struct WatchlistBody: Encodable { var type: TitleType; var tmdbId: Int; var on: Bool }

private struct PlayBody: Encodable {
    var mediaType: MediaKind
    var tmdbId: Int
    var season: Int?
    var episode: Int?
    var candidateId: String?
    var startMs: Int?
    var audioStreamIndex: Int?
    var caps: ClientCaps
}

private struct ProgressBody: Encodable {
    var mediaType: MediaKind
    var tmdbId: Int
    var season: Int?
    var episode: Int?
    var positionMs: Int
    var durationMs: Int
    var sessionId: String?
}

private struct WatchedBody: Encodable {
    var mediaType: MediaKind
    var tmdbId: Int
    var season: Int?
    var episode: Int?
    var watched: Bool
}

// MARK: - Cache

/// How a catalog read uses the answers kept on this device.
public enum CachePolicy: Sendable {
    /// The kept answer while the server's `max-age` says it's fresh; otherwise ask.
    case fresh
    /// Whatever is kept, however old, without asking; throws `.notCached` when there's none.
    /// With `.fresh` after it, a screen shows the old answer while the new one loads.
    case cachedOnly
    /// Always ask the server (pull to refresh).
    case reload
}

/// GET bodies the server let us keep, in memory and (when persistent) on disk, each with
/// the `max-age` it came with. Stale entries stay until replaced: they're what a screen
/// shows while it asks again.
actor ResponseCache {
    struct Entry: Codable {
        var storedAt: Date
        var maxAge: TimeInterval
        var body: Data
        var isFresh: Bool { Date().timeIntervalSince(storedAt) < maxAge }
    }

    nonisolated let ttl: TimeInterval
    private let directory: URL?
    nonisolated var isPersistent: Bool { directory != nil }
    private var entries: [String: Entry] = [:]
    private var running: [String: Task<(Data, TimeInterval?), Error>] = [:]
    private var pruned = false
    private let limit = 64
    /// Disk entries older than this are past any use, even as a placeholder.
    private static let diskLifetime: TimeInterval = 30 * 24 * 3600

    init(ttl: TimeInterval, directory: URL? = nil) {
        self.ttl = ttl
        self.directory = directory
    }

    /// One folder per token, so answers never cross accounts.
    static func directory(for token: String?) -> URL? {
        guard let token, let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        return caches.appendingPathComponent("strata-api", isDirectory: true).appendingPathComponent(digest(token), isDirectory: true)
    }

    /// `max-age` from Cache-Control (0: keep it, but ask again next time); -1 for `no-store`;
    /// nil when it doesn't say.
    nonisolated static func maxAge(_ response: HTTPURLResponse) -> TimeInterval? {
        guard let header = response.value(forHTTPHeaderField: "Cache-Control")?.lowercased() else { return nil }
        if header.contains("no-store") { return -1 }
        if header.contains("no-cache") { return 0 }
        guard let range = header.range(of: #"max-age=\d+"#, options: .regularExpression) else { return nil }
        return TimeInterval(header[range].dropFirst("max-age=".count))
    }

    func entry(_ key: String) -> Entry? {
        if let e = entries[key] { return e }
        guard let file = file(for: key), let data = try? Data(contentsOf: file),
              let e = try? PropertyListDecoder().decode(Entry.self, from: data) else { return nil }
        remember(key, e)
        return e
    }

    func set(_ key: String, _ data: Data, maxAge: TimeInterval?) {
        let maxAge = maxAge ?? ttl
        guard maxAge >= 0 else { return remove(key) }
        let e = Entry(storedAt: Date(), maxAge: maxAge, body: data)
        remember(key, e)
        guard let directory, let file = file(for: key) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? PropertyListEncoder().encode(e).write(to: file, options: .atomic)
        pruneOnce()
    }

    /// Drops these paths and everything under them (`/api/titles/show/1` takes its seasons).
    func remove(_ paths: [String]) {
        func matches(_ key: String) -> Bool {
            paths.contains { key == $0 || key.hasPrefix($0 + "/") || key.hasPrefix($0 + "?") }
        }
        for key in entries.keys where matches(key) { entries[key] = nil }
        for key in running.keys where matches(key) { running[key] = nil }
        guard let directory, let files = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
        let prefixes = paths.map { Self.fileStem($0) + "-" }
        for name in files where prefixes.contains(where: name.hasPrefix) {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    func clear() {
        entries.removeAll()
        running.removeAll()
        if let directory { try? FileManager.default.removeItem(at: directory) }
    }

    /// The request already on its way for `key`, or a new one.
    func shared(_ key: String, _ work: @escaping @Sendable () async throws -> (Data, TimeInterval?)) -> Task<(Data, TimeInterval?), Error> {
        if let task = running[key] { return task }
        let task = Task { try await work() }
        running[key] = task
        return task
    }

    /// Forgets the request (if it's still the current one: a clear or a change since it
    /// started means its answer may be out of date) and stores its answer.
    func finished(_ key: String, _ task: Task<(Data, TimeInterval?), Error>, result: (Data, TimeInterval?)?) {
        guard running[key] == task else { return }
        running[key] = nil
        if let result { set(key, result.0, maxAge: result.1) }
    }

    private func remove(_ key: String) {
        entries[key] = nil
        if let file = file(for: key) { try? FileManager.default.removeItem(at: file) }
    }

    private func remember(_ key: String, _ e: Entry) {
        if entries[key] == nil, entries.count >= limit, let oldest = entries.min(by: { $0.value.storedAt < $1.value.storedAt })?.key {
            entries[oldest] = nil
        }
        entries[key] = e
    }

    /// Readable path first (so `remove` can match a whole title by prefix), then a digest
    /// of the full key (the query, and to keep names unique and short).
    private func file(for key: String) -> URL? {
        guard let directory else { return nil }
        let path = key.split(separator: "?", maxSplits: 1).first.map(String.init) ?? key
        return directory.appendingPathComponent("\(Self.fileStem(path))-\(Self.digest(key).prefix(16)).plist")
    }

    private static func fileStem(_ path: String) -> String {
        path.split(separator: "/").map { $0.filter { $0.isLetter || $0.isNumber || $0 == "-" } }.joined(separator: "-")
    }

    private static func digest(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Once per launch: sweeps out entries too old to be worth showing.
    private func pruneOnce() {
        guard !pruned, let directory else { return }
        pruned = true
        let fm = FileManager.default
        let cutoff = Date().addingTimeInterval(-Self.diskLifetime)
        for url in (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if modified < cutoff { try? fm.removeItem(at: url) }
        }
    }
}

/// Drops the bearer token when a redirect leaves the server's origin, so a
/// redirect can never carry credentials to another host.
final class RedirectGuard: NSObject, URLSessionTaskDelegate, Sendable {
    let origin: URL
    init(origin: URL) { self.origin = origin }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? {
        guard let url = request.url, !StrataClient.sameOrigin(url, origin) else { return request }
        var stripped = request
        stripped.setValue(nil, forHTTPHeaderField: "Authorization")
        return stripped
    }
}
