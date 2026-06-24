import Foundation

public struct JellyfinClient: Sendable {
    public let serverURL: URL
    public let session: Session?
    public let urlSession: URLSession

    public init(session: Session, urlSession: URLSession = StrataNetworking.apiSession) {
        self.serverURL = session.serverURL
        self.session = session
        self.urlSession = urlSession
    }

    public init(unauthenticated serverURL: URL, urlSession: URLSession = StrataNetworking.apiSession) {
        self.serverURL = serverURL
        self.session = nil
        self.urlSession = urlSession
    }

    /// Drops all cached GET responses. Call after a mutation that changes list
    /// contents, or on an explicit pull-to-refresh.
    public static func clearResponseCache() async {
        await ResponseCache.shared.clear()
    }

    /// How a library listing is ordered. Mirrors Jellyfin's `sortBy`/`sortOrder`.
    public struct ItemSort: Sendable, Equatable, Hashable {
        public enum Field: String, Sendable, CaseIterable, Hashable {
            case dateAdded = "DateCreated"
            case title = "SortName"
            case year = "ProductionYear"
            case rating = "CommunityRating"
            case premiere = "PremiereDate"
            case runtime = "Runtime"

            public var label: String {
                switch self {
                case .dateAdded: return "Date Added"
                case .title: return "Title"
                case .year: return "Year"
                case .rating: return "Rating"
                case .premiere: return "Release Date"
                case .runtime: return "Runtime"
                }
            }
        }
        public enum Order: String, Sendable, Hashable {
            case ascending = "Ascending"
            case descending = "Descending"
        }
        public var field: Field
        public var order: Order
        public init(field: Field, order: Order) {
            self.field = field
            self.order = order
        }
        public static let recentlyAdded = ItemSort(field: .dateAdded, order: .descending)
        public static let titleAsc = ItemSort(field: .title, order: .ascending)
    }

    // MARK: - Auth

    public func authenticate(username: String, password: String) async throws -> AuthResult {
        let body: [String: String] = ["Username": username, "Pw": password]
        return try await post(path: "/Users/AuthenticateByName", body: body, as: AuthResult.self, includeUserAuth: false)
    }

    // MARK: - Library

    public func listMovies(
        sort: ItemSort = .recentlyAdded,
        genres: [String]? = nil,
        limit: Int? = nil
    ) async throws -> [BaseItem] {
        try await getItems(includeItemTypes: ["Movie", "BoxSet"],
                           genres: genres, sort: sort, limit: limit,
                           fields: Self.movieFields)
    }

    public func listShows(
        sort: ItemSort = .recentlyAdded,
        genres: [String]? = nil,
        limit: Int? = nil
    ) async throws -> [BaseItem] {
        try await getItems(includeItemTypes: ["Series"],
                           genres: genres, sort: sort, limit: limit,
                           fields: ["Overview", "Genres"])
    }

    /// Newest additions across films and series, merged and date-sorted by the
    /// server — backs the "Recently Added" shelf on Home.
    public func recentlyAdded(limit: Int = 20) async throws -> [BaseItem] {
        try await getItems(includeItemTypes: ["Movie", "Series", "BoxSet"],
                           sort: .recentlyAdded, limit: limit,
                           fields: ["Overview", "Genres"])
    }

    /// The user's favorited items (the "My List" screen).
    public func favorites(limit: Int? = nil) async throws -> [BaseItem] {
        try await getItems(includeItemTypes: ["Movie", "Series", "BoxSet"],
                           isFavorite: true, sort: .titleAsc, limit: limit,
                           fields: ["Overview", "Genres"])
    }

    /// Distinct genre names available for the given item types — drives the
    /// genre browser reached by tapping a genre chip.
    public func genreList(itemTypes: [String]) async throws -> [String] {
        let userId = try requireUserId()
        let q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "includeItemTypes", value: itemTypes.joined(separator: ",")),
            .init(name: "recursive", value: "true"),
            .init(name: "sortBy", value: "SortName")
        ]
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Genres", query: q)
        return (env.items ?? []).compactMap { $0.name }
    }

    /// Intro / credits (and other) timestamped segments for an item, from
    /// Jellyfin's native MediaSegments API (populated by the intro-skipper
    /// plugin). Returns an empty array when the plugin isn't present or hasn't
    /// analysed the item, so callers simply show no skip button.
    public func mediaSegments(
        itemId: String,
        types: [MediaSegment.Kind] = [.intro, .outro]
    ) async throws -> [MediaSegment] {
        var q: [URLQueryItem] = []
        for t in types { q.append(.init(name: "includeSegmentTypes", value: t.rawValue)) }
        let env: MediaSegmentEnvelope = try await get(path: "/MediaSegments/\(itemId)", query: q)
        return env.items ?? []
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
        // Favoriting changes the My List / favorites listings — drop cached
        // GETs so the next read reflects the toggle.
        await ResponseCache.shared.clear()
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

    /// Items contained in a collection (BoxSet). `recursive=true` is required:
    /// a collection member's real ParentId is its library folder, not the
    /// collection, so a plain parentId query returns nothing. Recursive
    /// traverses the collection link to return the linked titles.
    public func getCollectionItems(collectionId: String) async throws -> [BaseItem] {
        let userId = try requireUserId()
        let q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "parentId", value: collectionId),
            .init(name: "recursive", value: "true"),
            .init(name: "sortBy", value: "SortName"),
            .init(name: "sortOrder", value: "Ascending"),
            .init(name: "fields", value: Self.movieFields.joined(separator: ","))
        ]
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Items", query: q)
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
            "MaxStreamingBitrate": maxStreamingBitrate,
            // Sending DeviceProfile makes Jellyfin's DirectPlay decision
            // authoritative — without it the server returns
            // SupportsDirectPlay=false on every MediaSource and the
            // client falls back to a forced HLS transcode. Mirrors the
            // approach the web client adopted; see
            // apps/web/src/lib/api.ts buildDeviceProfile().
            "DeviceProfile": Self.avFoundationDeviceProfile
        ]
        if let audioStreamIndex { body["AudioStreamIndex"] = audioStreamIndex }
        if let subtitleStreamIndex { body["SubtitleStreamIndex"] = subtitleStreamIndex }
        // Echo the api_key on the request URL so Jellyfin embeds it in the
        // TranscodingUrl it returns — AVPlayer's URLSession can't reach
        // back for our X-Emby-Authorization header on segment fetches.
        var q: [URLQueryItem] = [.init(name: "userId", value: userId)]
        if let token = session?.token, !token.isEmpty {
            q.append(.init(name: "api_key", value: token))
        }
        return try await post(
            path: "/Items/\(itemId)/PlaybackInfo",
            query: q,
            jsonBody: body,
            as: PlaybackInfoResponse.self
        )
    }

    /// Codec / container support advertised to Jellyfin so it can pick
    /// DirectPlay when AVFoundation can decode the source. Scoped to what
    /// AVPlayer can actually demux — anything else (MKV, MPEG-4 ASP,
    /// Opus/Vorbis in MP4, …) routes through the HLS TranscodingProfile.
    /// AVFoundation cannot demux Matroska on any iOS/macOS/tvOS version,
    /// so MKV is intentionally absent from DirectPlayProfiles.
    private static let avFoundationDeviceProfile: [String: Any] = [
        "Name": "Strata Apple",
        "MaxStreamingBitrate": 120_000_000,
        "MaxStaticBitrate": 200_000_000,
        "DirectPlayProfiles": [
            [
                "Type": "Video",
                "Container": "mp4,m4v,mov",
                "VideoCodec": "h264,hevc,h265",
                "AudioCodec": "aac,ac3,eac3,alac,mp3,flac"
            ],
            ["Type": "Audio", "Container": "mp3", "AudioCodec": "mp3"],
            ["Type": "Audio", "Container": "m4a,aac", "AudioCodec": "aac"],
            ["Type": "Audio", "Container": "flac", "AudioCodec": "flac"],
            ["Type": "Audio", "Container": "alac,m4a", "AudioCodec": "alac"],
            ["Type": "Audio", "Container": "wav", "AudioCodec": "pcm_s16le,pcm_s24le"]
        ],
        "TranscodingProfiles": [
            // Protocol values are the case-sensitive
            // MediaStreamProtocol enum names — "Hls"/"Http", not
            // "hls"/"http". Lowercase makes Jellyfin's .NET
            // deserializer reject the profile silently, which leaves
            // TranscodingUrl nil and breaks all non-DirectPlay
            // playback.
            [
                "Type": "Video",
                "Container": "ts",
                "Protocol": "Hls",
                "VideoCodec": "h264",
                "AudioCodec": "aac,mp3",
                "Context": "Streaming",
                "MaxAudioChannels": "6",
                "MinSegments": 1,
                "BreakOnNonKeyFrames": true
            ],
            [
                "Type": "Audio",
                "Container": "mp3",
                "Protocol": "Http",
                "AudioCodec": "mp3",
                "Context": "Streaming"
            ]
        ],
        "ContainerProfiles": [],
        "CodecProfiles": [],
        "SubtitleProfiles": [
            ["Format": "vtt", "Method": "External"],
            ["Format": "ass", "Method": "External"],
            ["Format": "ssa", "Method": "External"],
            ["Format": "srt", "Method": "External"],
            ["Format": "sub", "Method": "External"],
            ["Format": "pgssub", "Method": "External"]
        ]
    ]

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

    /// The next episode to watch for a series. Jellyfin's NextUp tracks the
    /// in-progress (or next-unwatched) episode, so a mid-series viewer resumes
    /// where they left off instead of restarting at S01E01. Returns nil for a
    /// fresh series — callers fall back to the first episode.
    public func nextUp(seriesId: String) async throws -> BaseItem? {
        let userId = try requireUserId()
        let q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "seriesId", value: seriesId),
            .init(name: "limit", value: "1"),
            .init(name: "fields", value: "Overview,MediaSources"),
            .init(name: "enableImageTypes", value: "Primary,Backdrop,Thumb")
        ]
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Shows/NextUp", query: q)
        return env.items?.first
    }

    /// Next-up episodes across every series — the next unwatched (or in-progress)
    /// episode for each show the viewer is partway through. Powers the Home
    /// "Watch Next" rail so a returning viewer can jump straight into the next
    /// episode without drilling into the series. Unlike `nextUp(seriesId:)` this
    /// omits the series filter, so Jellyfin returns one entry per show.
    public func nextUp(limit: Int = 12) async throws -> [BaseItem] {
        let userId = try requireUserId()
        let q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "limit", value: String(limit)),
            .init(name: "fields", value: "Overview"),
            .init(name: "enableImageTypes", value: "Primary,Backdrop,Thumb")
        ]
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Shows/NextUp", query: q)
        return env.items ?? []
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
        genres: [String]? = nil,
        isFavorite: Bool = false,
        sort: ItemSort = .recentlyAdded,
        limit: Int? = nil,
        fields: [String]
    ) async throws -> [BaseItem] {
        let userId = try requireUserId()
        var q: [URLQueryItem] = [
            .init(name: "userId", value: userId),
            .init(name: "includeItemTypes", value: includeItemTypes.joined(separator: ",")),
            .init(name: "recursive", value: "true"),
            .init(name: "sortBy", value: sort.field.rawValue),
            .init(name: "sortOrder", value: sort.order.rawValue),
            .init(name: "fields", value: fields.joined(separator: ","))
        ]
        if let searchTerm { q.append(.init(name: "searchTerm", value: searchTerm)) }
        // Jellyfin expects genres pipe-delimited.
        if let genres, !genres.isEmpty {
            q.append(.init(name: "genres", value: genres.joined(separator: "|")))
        }
        if isFavorite { q.append(.init(name: "filters", value: "IsFavorite")) }
        if let limit { q.append(.init(name: "limit", value: String(limit))) }
        let env: ItemsEnvelope<BaseItem> = try await get(path: "/Items", query: q)
        return env.items ?? []
    }

    /// Connectivity hiccups worth one automatic retry — not auth/DNS/cancel.
    private static func isTransient(_ error: URLError) -> Bool {
        switch error.code {
        case .timedOut, .networkConnectionLost, .cannotConnectToHost,
             .dnsLookupFailed, .notConnectedToInternet:
            return true
        default:
            return false
        }
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
        let isGET = (req.httpMethod ?? "GET").uppercased() == "GET"

        // Serve a fresh-enough cached body for repeat GETs (tab reappears,
        // back-navigation) without a round-trip.
        if isGET, let cached = await ResponseCache.shared.data(for: urlString, now: Date()),
           let decoded = try? JSONDecoder().decode(T.self, from: cached) {
            return decoded
        }

        // Idempotent GETs get one retry on a transient connectivity blip so a
        // single dropped packet on LTE doesn't surface as a hard failure.
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await urlSession.data(for: req)
        } catch let error as URLError where isGET && Self.isTransient(error) {
            Log.net.error("\(req.httpMethod ?? "?") \(urlString, privacy: .public) — transient \(error.code.rawValue), retrying")
            (data, response) = try await urlSession.data(for: req)
        }
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
            let decoded = try JSONDecoder().decode(T.self, from: data)
            if isGET { await ResponseCache.shared.store(data, for: urlString, now: Date()) }
            return decoded
        } catch {
            Log.net.error("Decode failed for \(urlString, privacy: .public): \(String(describing: error), privacy: .public)")
            throw RequestError.decoding(String(describing: error))
        }
    }
}
