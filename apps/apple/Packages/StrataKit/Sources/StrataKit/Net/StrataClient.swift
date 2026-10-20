import Foundation

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
    ///   - cacheTTL: lifetime of cached GET responses (home/browse/search/titles); 0 disables.
    public init(baseURL: URL, token: String? = nil, session: URLSession = StrataNetworking.apiSession, cacheTTL: TimeInterval = 30) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.cache = ResponseCache(ttl: cacheTTL)
    }

    private init(baseURL: URL, token: String?, session: URLSession, cache: ResponseCache) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.cache = cache
    }

    /// Same server and cache, different credentials.
    public func withToken(_ token: String?) -> StrataClient {
        StrataClient(baseURL: baseURL, token: token, session: session, cache: ResponseCache(ttl: cache.ttl))
    }

    /// Same token, different address (address fallback).
    public func withBaseURL(_ url: URL) -> StrataClient {
        StrataClient(baseURL: url, token: token, session: session, cache: cache)
    }

    /// Drops cached GET responses (e.g. after pull-to-refresh).
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

    public func home() async throws -> [Shelf] {
        let res: ShelvesResponse = try await get("/api/home")
        return res.shelves
    }

    public func browse(_ type: TitleType, list: BrowseList) async throws -> [TitleCard] {
        let res: ItemsResponse<TitleCard> = try await get("/api/browse/\(type.rawValue)/\(list.rawValue)")
        return res.items
    }

    public func search(_ query: String) async throws -> [TitleCard] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        let res: ItemsResponse<TitleCard> = try await get("/api/search", query: [URLQueryItem(name: "q", value: q)])
        return res.items
    }

    public func movie(_ tmdbId: Int) async throws -> MovieDetail {
        try await get("/api/titles/movie/\(tmdbId)")
    }

    public func show(_ tmdbId: Int) async throws -> ShowDetail {
        try await get("/api/titles/show/\(tmdbId)")
    }

    public func season(show tmdbId: Int, _ season: Int) async throws -> SeasonDetail {
        try await get("/api/titles/show/\(tmdbId)/seasons/\(season)")
    }

    /// Library sources (instant); `discover: true` adds scraper releases (takes a few seconds).
    public func sources(_ target: PlaybackTarget, discover: Bool = false) async throws -> [Candidate] {
        var query = target.queryItems
        if discover { query.append(URLQueryItem(name: "discover", value: "1")) }
        let res: ItemsResponse<Candidate> = try await get("/api/sources", query: query, cached: false)
        return res.items
    }

    // MARK: - Playback

    /// Starts a playback session. `startMs` nil resumes from saved progress.
    /// Returns `.downloading` (HTTP 202) while a release is still downloading on TorBox;
    /// repeat the same call to poll.
    public func play(_ target: PlaybackTarget,
                     candidateId: String? = nil,
                     startMs: Int? = nil,
                     audioStreamIndex: Int? = nil,
                     caps: ClientCaps = .current) async throws -> PlayOutcome {
        let body = PlayBody(mediaType: target.mediaType, tmdbId: target.tmdbId, season: target.season, episode: target.episode,
                            candidateId: candidateId, startMs: startMs, audioStreamIndex: audioStreamIndex, caps: caps)
        let (data, status) = try await perform(request("POST", "/api/play", body: body))
        if status == 202 {
            return .downloading(try decode(DownloadingStatus.self, from: data))
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
        await cache.clear()
        return res
    }

    public func setWatched(_ target: PlaybackTarget, _ watched: Bool) async throws {
        let body = WatchedBody(mediaType: target.mediaType, tmdbId: target.tmdbId, season: target.season, episode: target.episode, watched: watched)
        let _: OKResponse = try await send("POST", "/api/watched", body: body)
        await cache.clear()
    }

    public func setWatchlist(_ type: TitleType, tmdbId: Int, _ on: Bool) async throws {
        let _: OKResponse = try await send("PUT", "/api/watchlist", body: WatchlistBody(type: type, tmdbId: tmdbId, on: on))
        await cache.clear()
    }

    /// Fetches a WebVTT track. The server extracts embedded tracks on demand and answers
    /// 202 while that runs; this retries with backoff (honouring Retry-After) until the
    /// text arrives, `maxWait` passes, or the task is cancelled.
    /// Whether `url` points at this client's server (scheme, host and port).
    public func isSameOrigin(_ url: URL) -> Bool {
        func port(_ u: URL) -> Int? { u.port ?? (u.scheme?.lowercased() == "https" ? 443 : u.scheme?.lowercased() == "http" ? 80 : nil) }
        return url.scheme?.lowercased() == baseURL.scheme?.lowercased()
            && url.host()?.lowercased() == baseURL.host()?.lowercased()
            && port(url) == port(baseURL)
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

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], cached: Bool = true) async throws -> T {
        let req = try request("GET", path, query: query)
        let key = cacheKey(req)
        if cached, let hit = await cache.get(key) {
            return try decode(T.self, from: hit)
        }
        let (data, _) = try await perform(req)
        let value = try decode(T.self, from: data)
        if cached { await cache.set(key, data) }
        return value
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
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return req
    }

    /// Returns body + status for 2xx; throws `StrataError` otherwise.
    private func perform(_ req: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await rawData(req)
        let status = response.statusCode
        guard (200..<300).contains(status) else { throw httpError(status, data) }
        return (data, status)
    }

    private func rawData(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: req)
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

    private func cacheKey(_ req: URLRequest) -> String {
        (req.url?.absoluteString ?? "") + "|" + (token ?? "")
    }
}

// MARK: - Bodies

private struct Empty: Encodable {}
private struct ErrorBody: Decodable { var error: String? }
private struct Credentials: Encodable { var username: String; var password: String; var deviceName: String }
private struct PinBody: Encodable { var pin: String? }
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

/// Tiny in-memory TTL cache for GET bodies.
actor ResponseCache {
    nonisolated let ttl: TimeInterval
    private var entries: [String: (at: Date, data: Data)] = [:]
    private let limit = 64

    init(ttl: TimeInterval) { self.ttl = ttl }

    func get(_ key: String) -> Data? {
        guard ttl > 0, let e = entries[key] else { return nil }
        if Date().timeIntervalSince(e.at) > ttl {
            entries[key] = nil
            return nil
        }
        return e.data
    }

    func set(_ key: String, _ data: Data) {
        guard ttl > 0 else { return }
        if entries.count >= limit, let oldest = entries.min(by: { $0.value.at < $1.value.at })?.key {
            entries[oldest] = nil
        }
        entries[key] = (Date(), data)
    }

    func clear() { entries.removeAll() }
}
