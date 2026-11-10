import Foundation

/// The sources you picked, kept on this device per server, so Play comes back to them:
/// the same file for a movie or episode, and for the rest of a show, the copy of each
/// episode most like the one you chose (same resolution, release type and HDR).
public final class SourceMemory: @unchecked Sendable {
    public static let shared = SourceMemory()

    /// What a pick says about the copies you want of the rest of a show.
    struct Traits: Codable, Equatable {
        var resolution: Int?
        var source: String?
        var hdr: String?
        var videoCodec: String?

        init(_ c: Candidate) {
            resolution = c.resolution
            source = c.source?.lowercased()
            hdr = c.hdr?.lowercased()
            videoCodec = c.videoCodec?.lowercased()
        }

        /// How alike a copy is: 0 when the resolution differs (not a match at all).
        func score(_ c: Candidate) -> Int {
            let other = Traits(c)
            guard resolution == other.resolution else { return 0 }
            return 1 + (source == other.source ? 4 : 0) + (hdr == other.hdr ? 2 : 0) + (videoCodec == other.videoCodec ? 1 : 0)
        }
    }

    private struct Pick: Codable {
        var id: String
        var at: Date
    }

    private struct Store: Codable {
        /// By server and target.
        var picks: [String: Pick] = [:]
        /// By server and show.
        var shows: [String: Traits] = [:]
    }

    private let defaults: UserDefaults
    private let key = "strata.sourcePicks"
    private let lock = NSLock()
    /// Kept to the most recent picks, so it never grows without end.
    private let limit = 500

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// Remembers a source you chose for `target`.
    public func remember(_ candidate: Candidate, for target: PlaybackTarget, server: URL) {
        lock.withLock {
            var store = load()
            let pick = Self.key(target, server)
            store.picks[pick] = Pick(id: candidate.id, at: Date())
            if target.mediaType == .episode { store.shows[Self.showKey(target, server)] = Traits(candidate) }
            if store.picks.count > limit {
                let oldest = store.picks.sorted { $0.value.at < $1.value.at }.prefix(store.picks.count - limit)
                for (key, _) in oldest { store.picks.removeValue(forKey: key) }
            }
            save(store)
        }
    }

    /// The source you picked for exactly this target, if any.
    public func pick(for target: PlaybackTarget, server: URL) -> String? {
        lock.withLock { load().picks[Self.key(target, server)]?.id }
    }

    /// Forgets the pick for `target` (its file is gone from the server).
    public func forget(_ target: PlaybackTarget, server: URL) {
        lock.withLock {
            var store = load()
            store.picks.removeValue(forKey: Self.key(target, server))
            save(store)
        }
    }

    /// Whether you picked a source for another episode of this show.
    public func hasShowPreference(_ target: PlaybackTarget, server: URL) -> Bool {
        guard target.mediaType == .episode else { return false }
        return lock.withLock { load().shows[Self.showKey(target, server)] != nil }
    }

    /// Of an episode's sources, the one most like what you picked for the show; nil when
    /// none has the same resolution.
    public func match(_ candidates: [Candidate], for target: PlaybackTarget, server: URL) -> Candidate? {
        guard let traits = lock.withLock({ load().shows[Self.showKey(target, server)] }) else { return nil }
        // The highest score; on a tie, the server's order (its best first).
        var best: (candidate: Candidate, score: Int)?
        for c in candidates {
            let score = traits.score(c)
            if score > (best?.score ?? 0) { best = (c, score) }
        }
        return best?.candidate
    }

    // MARK: - Storage

    private static func key(_ target: PlaybackTarget, _ server: URL) -> String {
        var key = "\(server.absoluteString)|\(target.title)"
        if let season = target.season, let episode = target.episode { key += "|\(season)x\(episode)" }
        return key
    }

    private static func showKey(_ target: PlaybackTarget, _ server: URL) -> String {
        "\(server.absoluteString)|\(target.title)"
    }

    private func load() -> Store {
        guard let data = defaults.data(forKey: key), let store = try? JSONDecoder().decode(Store.self, from: data) else { return Store() }
        return store
    }

    private func save(_ store: Store) {
        if let data = try? JSONEncoder().encode(store) { defaults.set(data, forKey: key) }
    }
}
