import Foundation

public struct JellyfinClient: Sendable {
    public let serverURL: URL
    public let session: Session?
    public let urlSession: URLSession

    public init(session: Session, urlSession: URLSession = .shared) {
        self.serverURL = session.serverURL
        self.session = session
        self.urlSession = urlSession
    }

    public init(unauthenticated serverURL: URL, urlSession: URLSession = .shared) {
        self.serverURL = serverURL
        self.session = nil
        self.urlSession = urlSession
    }

    // MARK: - Auth

    public func authenticate(username: String, password: String) async throws -> AuthResult {
        let body: [String: String] = ["Username": username, "Pw": password]
        return try await post(path: "/Users/AuthenticateByName", body: body, as: AuthResult.self, includeUserAuth: false)
    }

    // MARK: - Library

    public func listMovies() async throws -> [BaseItem] {
        try await getItems(includeItemTypes: ["Movie"], fields: Self.movieFields)
    }

    public func listShows() async throws -> [BaseItem] {
        try await getItems(includeItemTypes: ["Series"], fields: ["Overview", "Genres"])
    }

    public func continueWatching(kinds: [String] = ["Movie", "Episode"]) async throws -> [BaseItem] {
        let userId = try requireUserId()
        let q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "includeItemTypes", value: kinds.joined(separator: ",")),
            .init(name: "limit", value: "12"),
            .init(name: "fields", value: "Overview"),
            .init(name: "enableImageTypes", value: "Primary,Backdrop,Thumb")
        ]
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/UserItems/Resume", query: q)
        return env.items ?? []
    }

    public func search(_ term: String) async throws -> (movies: [BaseItem], shows: [BaseItem]) {
        let trimmed = term.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { return ([], []) }
        let items = try await getItems(
            includeItemTypes: ["Movie", "Series"],
            searchTerm: trimmed,
            limit: 50,
            fields: ["Overview"]
        )
        return (
            items.filter { $0.type == .movie },
            items.filter { $0.type == .series }
        )
    }

    public func getItem(_ itemId: String) async throws -> BaseItem {
        let userId = try requireUserId()
        let path = "/Users/\(userId)/Items/\(itemId)"
        let q: [URLQueryItem] = [
            .init(name: "fields", value: Self.detailFields.joined(separator: ","))
        ]
        return try await get(path: path, query: q)
    }

    public func getSimilarItems(itemId: String, limit: Int = 12) async throws -> [BaseItem] {
        let userId = try requireUserId()
        let q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "limit", value: String(limit)),
            .init(name: "fields", value: "Overview,Genres,ProductionYear")
        ]
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Items/\(itemId)/Similar", query: q)
        return env.items ?? []
    }

    public func setFavorite(itemId: String, isFavorite: Bool) async throws {
        let userId = try requireUserId()
        let path = "/Users/\(userId)/FavoriteItems/\(itemId)"
        let method = isFavorite ? "POST" : "DELETE"
        var req = try makeRequest(method: method, path: path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw RequestError.http(status: http.statusCode, body: nil)
        }
    }

    public func getSeasons(seriesId: String) async throws -> [BaseItem] {
        let userId = try requireUserId()
        let env: ItemsEnvelope<BaseItem> = try await get(
            path: "/Shows/\(seriesId)/Seasons",
            query: [.init(name: "userId", value: userId)]
        )
        return env.items ?? []
    }

    public func getEpisodes(seriesId: String, seasonId: String? = nil) async throws -> [BaseItem] {
        let userId = try requireUserId()
        var q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "fields", value: "Overview,MediaSources")
        ]
        if let seasonId { q.append(.init(name: "seasonId", value: seasonId)) }
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Shows/\(seriesId)/Episodes", query: q)
        return env.items ?? []
    }

    // MARK: - Playback

    func playbackInfo(
        itemId: String,
        audioStreamIndex: Int? = nil,
        subtitleStreamIndex: Int? = nil,
        maxStreamingBitrate: Int = 120_000_000
    ) async throws -> PlaybackInfoResponse {
        let userId = try requireUserId()
        var body: [String: Any] = [
            "UserId": userId,
            "AutoOpenLiveStream": true,
            "EnableDirectPlay": true,
            "EnableDirectStream": true,
            "EnableTranscoding": true,
            "MaxStreamingBitrate": maxStreamingBitrate
        ]
        if let audioStreamIndex { body["AudioStreamIndex"] = audioStreamIndex }
        if let subtitleStreamIndex { body["SubtitleStreamIndex"] = subtitleStreamIndex }
        let q: [URLQueryItem] = [.init(name: "userId", value: userId)]
        return try await post(
            path: "/Items/\(itemId)/PlaybackInfo",
            query: q,
            jsonBody: body,
            as: PlaybackInfoResponse.self
        )
    }

    public func reportPlaybackStart(itemId: String, playSessionId: String, mediaSourceId: String) async throws {
        let body: [String: Any] = [
            "ItemId": itemId,
            "PlaySessionId": playSessionId,
            "MediaSourceId": mediaSourceId,
            "CanSeek": true
        ]
        try await postIgnoringResponse(path: "/Sessions/Playing", jsonBody: body)
    }

    public func reportPlaybackProgress(
        itemId: String,
        playSessionId: String,
        mediaSourceId: String,
        positionSeconds: TimeInterval,
        isPaused: Bool
    ) async throws {
        let body: [String: Any] = [
            "ItemId": itemId,
            "PlaySessionId": playSessionId,
            "MediaSourceId": mediaSourceId,
            "PositionTicks": Int64(positionSeconds * 10_000_000),
            "IsPaused": isPaused,
            "CanSeek": true
        ]
        try await postIgnoringResponse(path: "/Sessions/Playing/Progress", jsonBody: body)
    }

    /// Fetch the trickplay manifest map for an item. Jellyfin returns
    /// `{ "<mediaSourceId>": { "<width>": <manifest> } }`. We surface the
    /// most-detailed manifest by default.
    public func trickplayManifests(itemId: String) async throws -> [String: [String: TrickplayManifest]] {
        let item = try await getItem(itemId)
        // Server returns trickplay nested in the item under "Trickplay" — but
        // older Jellyfins expose it via /Trickplay/<itemId>/<width>/0.jpg only
        // (no manifest). We return an empty dict in that case; the player
        // skips trickplay rendering.
        _ = item
        return [:]
    }

    public func nextEpisode(after episode: BaseItem) async throws -> BaseItem? {
        guard let seriesId = episode.seriesId else { return nil }
        let siblings = try await getEpisodes(seriesId: seriesId, seasonId: episode.seasonId)
        guard let idx = siblings.firstIndex(where: { $0.id == episode.id }),
              idx + 1 < siblings.count else { return nil }
        return siblings[idx + 1]
    }

    public func reportPlaybackStopped(
        itemId: String,
        playSessionId: String,
        mediaSourceId: String,
        positionSeconds: TimeInterval
    ) async throws {
        let body: [String: Any] = [
            "ItemId": itemId,
            "PlaySessionId": playSessionId,
            "MediaSourceId": mediaSourceId,
            "PositionTicks": Int64(positionSeconds * 10_000_000)
        ]
        try await postIgnoringResponse(path: "/Sessions/Playing/Stopped", jsonBody: body)
    }

    // MARK: - Helpers

    private static let movieFields = ["Overview", "Genres", "MediaSources", "MediaStreams", "OriginalTitle", "Taglines"]
    private static let detailFields = [
        "Overview", "Genres", "MediaSources", "MediaStreams",
        "OriginalTitle", "Taglines", "People", "ProductionYear", "PremiereDate"
    ]

    private func getItems(
        includeItemTypes: [String],
        searchTerm: String? = nil,
        limit: Int? = nil,
        fields: [String]
    ) async throws -> [BaseItem] {
        let userId = try requireUserId()
        var q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "includeItemTypes", value: includeItemTypes.joined(separator: ",")),
            .init(name: "recursive", value: "true"),
            .init(name: "sortBy", value: "DateCreated"),
            .init(name: "sortOrder", value: "Descending"),
            .init(name: "fields", value: fields.joined(separator: ","))
        ]
        if let searchTerm { q.append(.init(name: "searchTerm", value: searchTerm)) }
        if let limit { q.append(.init(name: "limit", value: String(limit))) }
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Items", query: q)
        return env.items ?? []
    }

    private func requireUserId() throws -> String {
        guard let id = session?.userId else { throw RequestError.notSignedIn }
        return id
    }

    // MARK: - HTTP

    public enum RequestError: Error, Sendable {
        case notSignedIn
        case invalidURL
        case http(status: Int, body: String?)
        case decoding(String)

        public var message: String {
            switch self {
            case .notSignedIn: return "Not signed in"
            case .invalidURL: return "Invalid URL"
            case .http(let status, let body):
                if let body, !body.isEmpty { return "HTTP \(status): \(body)" }
                return "HTTP \(status)"
            case .decoding(let s): return "Decoding failed: \(s)"
            }
        }
    }

    func authorizationHeader(includeToken: Bool = true) -> String {
        let device = DeviceInfo.modelName.replacingOccurrences(of: "\"", with: "")
        let deviceId = DeviceID.getOrCreate()
        var parts = [
            "Client=\"\(DeviceInfo.clientName)\"",
            "Device=\"\(device)\"",
            "DeviceId=\"\(deviceId)\"",
            "Version=\"\(DeviceInfo.clientVersion)\""
        ]
        if includeToken, let token = session?.token, !token.isEmpty {
            parts.append("Token=\"\(token)\"")
        }
        return "MediaBrowser " + parts.joined(separator: ", ")
    }

    private func makeRequest(
        method: String,
        path: String,
        query: [URLQueryItem] = [],
        includeUserAuth: Bool = true
    ) throws -> URLRequest {
        guard var comps = URLComponents(url: serverURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw RequestError.invalidURL
        }
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw RequestError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.addValue("application/json", forHTTPHeaderField: "Accept")
        req.addValue(authorizationHeader(includeToken: includeUserAuth), forHTTPHeaderField: "X-Emby-Authorization")
        return req
    }

    private func get<T: Decodable>(path: String, query: [URLQueryItem]) async throws -> T {
        var req = try makeRequest(method: "GET", path: path, query: query)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await perform(req)
    }

    private func post<T: Decodable, B: Encodable>(
        path: String,
        query: [URLQueryItem] = [],
        body: B,
        as: T.Type,
        includeUserAuth: Bool = true
    ) async throws -> T {
        var req = try makeRequest(method: "POST", path: path, query: query, includeUserAuth: includeUserAuth)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let enc = JSONEncoder()
        req.httpBody = try enc.encode(body)
        return try await perform(req)
    }

    private func post<T: Decodable>(
        path: String,
        query: [URLQueryItem] = [],
        jsonBody: [String: Any],
        as: T.Type
    ) async throws -> T {
        var req = try makeRequest(method: "POST", path: path, query: query)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: jsonBody, options: [])
        return try await perform(req)
    }

    private func postIgnoringResponse(path: String, jsonBody: [String: Any]) async throws {
        var req = try makeRequest(method: "POST", path: path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: jsonBody, options: [])
        let (_, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw RequestError.http(status: http.statusCode, body: nil)
        }
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        let urlString = req.url?.absoluteString ?? "<no url>"
        let (data, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            Log.net.error("\(req.httpMethod ?? "?") \(urlString, privacy: .public) — no HTTPURLResponse")
            throw RequestError.http(status: 0, body: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            Log.net.error("\(req.httpMethod ?? "?") \(urlString, privacy: .public) — HTTP \(http.statusCode) — \(body, privacy: .public)")
            throw RequestError.http(status: http.statusCode, body: body)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            Log.net.error("Decode failed for \(urlString, privacy: .public): \(String(describing: error), privacy: .public)")
            throw RequestError.decoding(String(describing: error))
        }
    }
}
