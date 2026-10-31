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

    /// First-run only: creates the server admin and their household. Returns a token.
    /// Needs `setupCode` (from the server's log) unless asked from the server's own machine.
    public func setupAdmin(username: String, password: String, householdName: String? = nil, setupCode: String? = nil) async throws -> String {
        let body = SetupBody(username: username, password: password, householdName: householdName, setupCode: setupCode)
        let res: TokenResponse = try await send("POST", "/api/setup/admin", body: body)
        return res.token
    }

    /// Signs in with a username, or an email when `login` has an "@". Returns the bearer
    /// token; use `withToken(_:)` for an authenticated client.
    public func signIn(login: String, password: String) async throws -> String {
        let login = login.trimmingCharacters(in: .whitespacesAndNewlines)
        let req: URLRequest
        if login.contains("@") {
            req = try request("POST", "/api/auth/sign-in/email", body: EmailCredentials(email: login, password: password))
        } else {
            req = try request("POST", "/api/auth/sign-in/username", body: Credentials(username: login, password: password))
        }
        let (data, response) = try await performWithResponse(req)
        // The bearer plugin puts the signed token in this header; the body has it too.
        if let token = response.value(forHTTPHeaderField: "set-auth-token"), !token.isEmpty { return token }
        if let token = try decode(SignInResponse.self, from: data).token, !token.isEmpty { return token }
        throw StrataError(kind: .decoding, message: "The server signed you in but sent no session. Is the app up to date?")
    }

    /// Ends this session on the server.
    public func signOut() async throws {
        let _: OKResponse = try await send("POST", "/api/auth/sign-out", body: EmptyBody())
        await cache.clear()
    }

    public func me() async throws -> Me {
        try await get("/api/me", cached: false)
    }

    // MARK: Households

    /// The households this account belongs to.
    public func households() async throws -> [HouseholdSummary] {
        try await get("/api/auth/organization/list", cached: false)
    }

    /// Makes `id` this session's household: the library, lists and limits it sees.
    public func setActiveHousehold(_ id: String) async throws {
        let _: OKResponse = try await send("POST", "/api/auth/organization/set-active", body: SetActiveBody(organizationId: id))
        await cache.clear()
    }

    /// Changes the account's password and signs it out everywhere else. Returns the new
    /// session's token when the server issued one (the old one stops working).
    public func changePassword(current: String, new: String) async throws -> String? {
        let body = ChangePasswordBody(currentPassword: current, newPassword: new, revokeOtherSessions: true)
        let (data, response) = try await performWithResponse(request("POST", "/api/auth/change-password", body: body))
        if let token = response.value(forHTTPHeaderField: "set-auth-token"), !token.isEmpty { return token }
        return (try? JSONDecoder().decode(SignInResponse.self, from: data))?.token
    }

    // MARK: Home-network join

    /// Who can be picked to join a home server without a password (only when `ServerInfo.localJoin`).
    public func homeJoinChoices() async throws -> HomeJoinChoices {
        try await send("POST", "/api/join", body: JoinBody(userId: nil))
    }

    /// Joins as `userId` without a password. The session can watch but not administer.
    public func join(userId: String) async throws -> String {
        let res: TokenResponse = try await send("POST", "/api/join", body: JoinBody(userId: userId))
        return res.token
    }

    // MARK: Sign-in by code (RFC 8628: a TV shows a code; a signed-in phone approves it)

    /// The client id the server accepts for the Apple TV app.
    public static let tvClientID = "strata-apple-tv"

    /// Starts a code for this device. Unauthenticated: the device isn't signed in yet.
    public func startDeviceCode(clientID: String = StrataClient.tvClientID) async throws -> DeviceCode {
        try await send("POST", "/api/auth/device/code", body: DeviceCodeBody(client_id: clientID))
    }

    /// One poll for the code's token. The server answers 400 with an OAuth error while
    /// it waits, so those come back as states, not errors.
    public func pollDeviceCode(_ deviceCode: String, clientID: String = StrataClient.tvClientID) async throws -> DeviceTokenPoll {
        let body = DeviceTokenBody(grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode, client_id: clientID)
        let (data, response) = try await rawData(request("POST", "/api/auth/device/token", body: body))
        if (200..<300).contains(response.statusCode) {
            let token = try decode(DeviceAccessToken.self, from: data).access_token
            return .approved(token: token)
        }
        let err = httpError(response.statusCode, data)
        switch err.code {
        case "authorization_pending": return .pending
        case "slow_down": return .slowDown
        case "expired_token": return .expired
        case "access_denied": return .denied
        default: throw err
        }
    }

    /// The phone side: looks a code up, which also claims it for this account (needed
    /// before it can be approved).
    public func deviceCodeStatus(userCode: String) async throws -> DeviceCodeStatus {
        try await get("/api/auth/device", query: [URLQueryItem(name: "user_code", value: DeviceCode.normalize(userCode))], cached: false)
    }

    /// Signs the TV in as this account, in this session's household, able only to watch.
    public func approveDevice(userCode: String) async throws {
        let _: OKResponse = try await send("POST", "/api/auth/device/approve", body: UserCodeBody(userCode: DeviceCode.normalize(userCode)))
    }

    public func denyDevice(userCode: String) async throws {
        let _: OKResponse = try await send("POST", "/api/auth/device/deny", body: UserCodeBody(userCode: DeviceCode.normalize(userCode)))
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

    /// TMDB genres for movies or shows, in the server's language.
    public func genres(_ type: TitleType) async throws -> [Genre] {
        let res: ItemsResponse<Genre> = try await get("/api/genres/\(type.rawValue)")
        return res.items
    }

    /// Rails for one genre: In Your Library, New, Popular, Top Rated.
    public func genreShelves(_ type: TitleType, genreId: Int) async throws -> [Shelf] {
        let res: ShelvesResponse = try await get("/api/browse/\(type.rawValue)/genre/\(genreId)")
        return res.shelves
    }

    /// `GET /api/shows`: the Shows tab's spotlight and rails (servers from 0.1.5).
    public func shows() async throws -> [Shelf] {
        let res: ShelvesResponse = try await get("/api/shows")
        return res.shelves
    }

    public func animeCategories() async throws -> [AnimeCategory] {
        let res: ItemsResponse<AnimeCategory> = try await get("/api/anime/categories")
        return res.items
    }

    /// The Anime tab's rails, for every category or just one.
    public func anime(category: String? = nil) async throws -> [Shelf] {
        let res: ShelvesResponse = try await get("/api/anime", query: category.map { [URLQueryItem(name: "category", value: $0)] } ?? [])
        return res.shelves
    }

    /// Episodes of the shows on this account's list: the last week and the next month.
    public func calendar() async throws -> [CalendarEpisode] {
        let res: ItemsResponse<CalendarEpisode> = try await get("/api/calendar")
        return res.items
    }

    public func person(_ id: Int) async throws -> PersonDetail {
        try await get("/api/person/\(id)")
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
    /// Returns `.needsProbe` (HTTP 428) when the server needs the file's media info first:
    /// read it, send it with `reportProbe`, then repeat the call.
    public func play(_ target: PlaybackTarget,
                     candidateId: String? = nil,
                     startMs: Int? = nil,
                     audioStreamIndex: Int? = nil,
                     caps: ClientCaps = .current) async throws -> PlayOutcome {
        let body = PlayBody(mediaType: target.mediaType, tmdbId: target.tmdbId, season: target.season, episode: target.episode,
                            candidateId: candidateId, startMs: startMs, audioStreamIndex: audioStreamIndex, caps: caps)
        let (data, response) = try await rawData(request("POST", "/api/play", body: body))
        let status = response.statusCode
        if status == 428 {
            let probe = try decode(NeedsProbeResponse.self, from: data).needsProbe
            return .needsProbe(fileId: probe.fileId, url: probe.url)
        }
        guard (200..<300).contains(status) else { throw httpError(status, data) }
        // 202: the server is getting the source ready; repeat the call to follow it.
        if status == 202 {
            return .preparing(try decode(PreparingStatus.self, from: data))
        }
        var res = try decode(PlayResponse.self, from: data)
        res.url = resolve(res.url)
        for i in res.subtitleTracks.indices {
            res.subtitleTracks[i].url = res.subtitleTracks[i].url.map(resolve)
        }
        return .started(res)
    }

    /// Sends the media info the app read from a file (answering `.needsProbe`). `info` is
    /// in the server's `MediaInfo` shape, as StrataRemux's `MediaInfo` encodes.
    public func reportProbe<Info: Encodable & Sendable>(fileId: Int, info: Info) async throws {
        let _: OKResponse = try await send("POST", "/api/files/\(fileId)/probe", body: info)
    }

    /// A fresh link to a device-mode file whose link stopped working mid-play.
    public func refreshLink(sessionId: String) async throws -> URL {
        let res: LinkResponse = try await send("POST", "/api/play/\(sessionId)/link", body: Empty())
        return resolve(res.url)
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

    /// Takes a title off Continue Watching and Next Up (until it's watched again); its
    /// progress is kept.
    public func hideFromContinue(_ type: TitleType, tmdbId: Int) async throws {
        let _: OKResponse = try await send("DELETE", "/api/continue/\(type.rawValue)/\(tmdbId)")
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
            req.httpShouldHandleCookies = false
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
        guard cached else { return try decode(T.self, from: try await perform(req).0) }
        // Screens appearing together often ask for the same thing: share one request.
        let task = await cache.shared(key) { try await self.perform(req).0 }
        let data: Data
        do {
            data = try await task.value
        } catch {
            await cache.finished(key, task, data: nil)
            throw error
        }
        await cache.finished(key, task, data: data)
        return try decode(T.self, from: data)
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
        // The bearer token is the only credential. Better Auth also sets a session cookie;
        // sending it back would mix accounts between saved sign-ins, and makes Better Auth
        // demand a browser's Origin header (403 "Missing or null Origin").
        req.httpShouldHandleCookies = false
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
        let (data, response) = try await performWithResponse(req)
        return (data, response.statusCode)
    }

    /// `perform`, keeping the response for its headers.
    private func performWithResponse(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await rawData(req)
        guard (200..<300).contains(response.statusCode) else { throw httpError(response.statusCode, data) }
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

    /// Strata's own routes answer `{ error }`; Better Auth `{ message, code }`, and its
    /// device-code routes OAuth's `{ error, error_description }`.
    private func httpError(_ status: Int, _ data: Data) -> StrataError {
        guard let body = try? JSONDecoder().decode(ErrorBody.self, from: data) else {
            return StrataError.http(status, serverMessage: nil)
        }
        if body.error_description != nil {
            return StrataError.http(status, serverMessage: body.error_description, code: body.error)
        }
        return StrataError.http(status, serverMessage: body.message ?? body.error, code: body.code)
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
private struct EmptyBody: Encodable {}
private struct ErrorBody: Decodable {
    var error: String?
    var message: String?
    var code: String?
    var error_description: String?
}
private struct Credentials: Encodable { var username: String; var password: String }
private struct EmailCredentials: Encodable { var email: String; var password: String }
private struct SetupBody: Encodable { var username: String; var password: String; var householdName: String?; var setupCode: String? }
private struct SetActiveBody: Encodable { var organizationId: String }
private struct ChangePasswordBody: Encodable { var currentPassword: String; var newPassword: String; var revokeOtherSessions: Bool }
private struct JoinBody: Encodable { var userId: String? }
private struct DeviceCodeBody: Encodable { var client_id: String }
private struct DeviceTokenBody: Encodable { var grant_type: String; var device_code: String; var client_id: String }
private struct DeviceAccessToken: Decodable { var access_token: String }
private struct UserCodeBody: Encodable { var userCode: String }
private struct WatchlistBody: Encodable { var type: TitleType; var tmdbId: Int; var on: Bool }

private struct LinkResponse: Decodable {
    var url: URL
}

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

    func clear() {
        entries.removeAll()
        running.removeAll()
    }

    private var running: [String: Task<Data, Error>] = [:]

    /// The request already on its way for `key`, or a new one.
    func shared(_ key: String, _ work: @escaping @Sendable () async throws -> Data) -> Task<Data, Error> {
        if let task = running[key] { return task }
        let task = Task { try await work() }
        running[key] = task
        return task
    }

    /// Forgets the request (if it's still the current one) and stores its answer.
    func finished(_ key: String, _ task: Task<Data, Error>, data: Data?) {
        guard running[key] == task else { return }
        running[key] = nil
        if let data { set(key, data) }
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
