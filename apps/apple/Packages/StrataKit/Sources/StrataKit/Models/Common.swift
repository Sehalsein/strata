import Foundation

/// A title in the catalog. TMDB "tv" is called `show` everywhere in the API.
public enum TitleType: String, Codable, Sendable, Hashable, CaseIterable {
    case movie, show

    public var label: String { self == .movie ? "Movie" : "Show" }
}

/// What actually plays: a movie or a single episode.
public enum MediaKind: String, Codable, Sendable, Hashable {
    case movie, episode
}

/// Where a file lives on the server side.
public enum Provider: String, Codable, Sendable, Hashable {
    case local, torbox

    public var label: String {
        switch self {
        case .local: "Library"
        case .torbox: "TorBox"
        }
    }
}

/// Saved watch progress for a movie or episode.
public struct WatchProgress: Codable, Sendable, Hashable {
    public var positionMs: Int
    public var durationMs: Int
    public var completed: Bool

    public init(positionMs: Int, durationMs: Int, completed: Bool) {
        self.positionMs = positionMs
        self.durationMs = durationMs
        self.completed = completed
    }

    /// 0...1, or 0 when the duration is unknown.
    public var fraction: Double { Formatting.fraction(positionMs, durationMs) }
    /// Worth showing a "Resume" affordance (not finished and past the first few seconds).
    public var isResumable: Bool { !completed && positionMs > 5_000 }
    public var remainingMs: Int { max(0, durationMs - positionMs) }
}

/// Small presentation-neutral formatting helpers shared by the models.
public enum Formatting {
    public static func fraction(_ positionMs: Int, _ durationMs: Int) -> Double {
        guard durationMs > 0 else { return 0 }
        return min(1, max(0, Double(positionMs) / Double(durationMs)))
    }

    /// "1h 42m", "48m", or nil for missing/zero.
    public static func runtime(minutes: Int?) -> String? {
        guard let minutes, minutes > 0 else { return nil }
        let h = minutes / 60, m = minutes % 60
        if h == 0 { return "\(m)m" }
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    /// Runtime string for a millisecond duration.
    public static func runtime(ms: Int?) -> String? {
        guard let ms, ms > 0 else { return nil }
        return runtime(minutes: Int((Double(ms) / 60_000).rounded()))
    }

    /// "12m left" style remaining time.
    public static func remaining(ms: Int) -> String? {
        runtime(ms: ms).map { "\($0) left" }
    }

    /// "S1 · E4"
    public static func episodeCode(season: Int, episode: Int) -> String {
        "S\(season) · E\(episode)"
    }

    /// "7.4" for a TMDB rating, nil when absent or zero.
    public static func rating(_ value: Double?) -> String? {
        guard let value, value > 0 else { return nil }
        return String(format: "%.1f", value)
    }

    /// Bytes as "4.2 GB" / "700 MB".
    public static func size(bytes: Int) -> String? {
        guard bytes > 0 else { return nil }
        let f = ByteCountFormatter()
        f.countStyle = .file
        return f.string(fromByteCount: Int64(bytes))
    }

    /// "2160p"/"1080p"/"4K"-free resolution label.
    public static func resolution(_ height: Int?) -> String? {
        guard let height, height > 0 else { return nil }
        return height >= 2160 ? "4K" : "\(height)p"
    }

    /// Parses "2008-05-30" (TMDB dates) into a Date at UTC midnight.
    /// A calendar date ("2020-01-01") as local midnight, so it displays as the same day
    /// in any time zone.
    public static func date(_ string: String?) -> Date? {
        guard let string, string.count >= 10 else { return nil }
        let cal = Calendar(identifier: .gregorian)
        let parts = string.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

extension Array where Element == Provider {
    /// Joined provider labels, e.g. "Library · TorBox".
    public var label: String { map(\.label).joined(separator: " · ") }
}
