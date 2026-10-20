import Foundation

// MARK: - Target

/// What to play / report progress for. Encodes to the server's target shape
/// `{mediaType, tmdbId, season?, episode?}`.
public struct PlaybackTarget: Codable, Sendable, Hashable {
    public var mediaType: MediaKind
    public var tmdbId: Int
    public var season: Int?
    public var episode: Int?

    public init(mediaType: MediaKind, tmdbId: Int, season: Int? = nil, episode: Int? = nil) {
        self.mediaType = mediaType
        self.tmdbId = tmdbId
        self.season = season
        self.episode = episode
    }

    public static func movie(_ tmdbId: Int) -> PlaybackTarget {
        PlaybackTarget(mediaType: .movie, tmdbId: tmdbId)
    }

    public static func episode(show tmdbId: Int, season: Int, episode: Int) -> PlaybackTarget {
        PlaybackTarget(mediaType: .episode, tmdbId: tmdbId, season: season, episode: episode)
    }

    /// The title this target belongs to (a movie, or the episode's show).
    public var titleType: TitleType { mediaType == .movie ? .movie : .show }

    /// The next episode of the same show.
    public func with(season: Int, episode: Int) -> PlaybackTarget {
        .episode(show: tmdbId, season: season, episode: episode)
    }

    public var queryItems: [URLQueryItem] {
        var items = [URLQueryItem(name: "mediaType", value: mediaType.rawValue), URLQueryItem(name: "tmdbId", value: String(tmdbId))]
        if let season { items.append(URLQueryItem(name: "season", value: String(season))) }
        if let episode { items.append(URLQueryItem(name: "episode", value: String(episode))) }
        return items
    }
}

// MARK: - Sources

/// A playable source: a library file (`file:<id>`) or a discovered release (`hash:<infohash>`).
public struct Candidate: Codable, Sendable, Hashable, Identifiable {
    public enum Availability: String, Codable, Sendable, Hashable {
        /// In the library; plays now.
        case ready
        /// TorBox has it cached; plays within seconds once added.
        case cached
        /// Must download first (play returns `.downloading`).
        case uncached

        public var label: String {
            switch self {
            case .ready: "Ready"
            case .cached: "Instant"
            case .uncached: "Download"
            }
        }
    }

    public struct AudioInfo: Codable, Sendable, Hashable {
        public var codec: String
        public var channels: Int
        public var language: String?

        public var channelLayout: String { Candidate.channelLayout(channels) }
    }

    public var id: String
    public var fileId: Int
    public var provider: Provider
    public var name: String
    public var size: Int
    /// Nominal height: 2160, 1080, 720…
    public var resolution: Int?
    /// remux | bluray | web | hdtv | dvd | cam
    public var source: String?
    public var videoCodec: String?
    /// dv | hdr10+ | hdr10 | hlg, or nil for SDR.
    public var hdr: String?
    public var audio: [AudioInfo]?
    public var durationMs: Int?
    public var probed: Bool
    public var availability: Availability
    public var seeders: Int?
    /// Torrent name for discovered releases.
    public var releaseTitle: String?
    public var isPack: Bool?

    public var isDiscovered: Bool { id.hasPrefix("hash:") }
    public var isReady: Bool { availability == .ready }
    public var resolutionLabel: String? { Formatting.resolution(resolution) }
    public var sizeLabel: String? { Formatting.size(bytes: size) }
    public var hdrLabel: String? {
        switch hdr?.lowercased() {
        case nil, "": nil
        case "dv": "Dolby Vision"
        case "hdr10+": "HDR10+"
        case "hdr10": "HDR10"
        case "hlg": "HLG"
        case let other?: other.uppercased()
        }
    }
    public var codecLabel: String? {
        switch videoCodec?.lowercased() {
        case nil: nil
        case "hevc", "h265": "HEVC"
        case "h264", "avc": "H.264"
        case "av1": "AV1"
        case let other?: other.uppercased()
        }
    }
    public var sourceLabel: String? {
        switch source?.lowercased() {
        case nil: nil
        case "remux": "Remux"
        case "bluray": "Blu-ray"
        case "web": "WEB"
        case "hdtv": "HDTV"
        case "dvd": "DVD"
        case "cam": "CAM"
        case let other?: other
        }
    }
    /// Quality chips, e.g. ["4K", "Dolby Vision", "HEVC", "Remux"]. Size is shown as text
    /// where it helps choose (`sizeLabel`), not as a chip.
    public var specLabels: [String] {
        [resolutionLabel, hdrLabel, codecLabel, sourceLabel].compactMap { $0 }
    }
    public var displayName: String { releaseTitle ?? name }

    static func channelLayout(_ channels: Int) -> String {
        switch channels {
        case 1: "Mono"
        case 2: "Stereo"
        case 6: "5.1"
        case 8: "7.1"
        default: "\(channels)ch"
        }
    }
}

// MARK: - Play

/// Device capabilities sent with `POST /api/play` (see server `capsSchema`).
public struct ClientCaps: Codable, Sendable, Hashable {
    public var containers: [String]
    public var videoCodecs: [String]
    public var audioCodecs: [String]
    public var maxHeight: Int
    public var hdr: [String]
    public var dvProfiles: [Int]

    public init(containers: [String], videoCodecs: [String], audioCodecs: [String], maxHeight: Int, hdr: [String], dvProfiles: [Int]) {
        self.containers = containers
        self.videoCodecs = videoCodecs
        self.audioCodecs = audioCodecs
        self.maxHeight = maxHeight
        self.hdr = hdr
        self.dvProfiles = dvProfiles
    }
}

public struct Chapter: Codable, Sendable, Hashable {
    public var startMs: Int
    public var title: String?

    public init(startMs: Int, title: String? = nil) {
        self.startMs = startMs
        self.title = title
    }

    /// Media time in seconds.
    public var start: TimeInterval { TimeInterval(startMs) / 1000 }
}

public struct AudioTrack: Codable, Sendable, Hashable, Identifiable {
    /// ffprobe stream index; send back as `audioStreamIndex`.
    public var index: Int
    public var codec: String
    public var channels: Int
    public var language: String?
    public var title: String?
    public var selected: Bool

    public var id: Int { index }
    /// "English · 5.1 · EAC3", falling back to the title or "Track n".
    public var displayTitle: String {
        let lang = language.flatMap(LanguageName.display)
        let head = title?.isEmpty == false ? title! : (lang ?? "Track \(index)")
        var parts = [head]
        if let lang, title?.isEmpty == false, !head.localizedCaseInsensitiveContains(lang) { parts.append(lang) }
        parts.append(Candidate.channelLayout(channels))
        parts.append(codec.uppercased())
        return parts.joined(separator: " · ")
    }
}

public struct SubtitleTrack: Codable, Sendable, Hashable, Identifiable {
    /// "s<stream>" (embedded) or "x<n>" (sidecar file).
    public var id: String
    public var codec: String
    public var language: String?
    public var title: String?
    public var forced: Bool
    public var isDefault: Bool
    public var external: Bool
    /// WebVTT URL (relative as sent by the server; `StrataClient` resolves it to absolute).
    /// Nil for bitmap formats (PGS/VobSub) the server can't convert.
    public var url: URL?

    public var isTextBased: Bool { url != nil }
    public var displayTitle: String {
        let lang = language.flatMap(LanguageName.display)
        var head = title?.isEmpty == false ? title! : (lang ?? "Track \(id)")
        if forced, !head.localizedCaseInsensitiveContains("forced") { head += " (Forced)" }
        return external ? "\(head) · External" : head
    }
}

public struct NextEpisode: Codable, Sendable, Hashable {
    public var season: Int
    public var episode: Int
    public var name: String
    public var stillUrl: URL?
    /// Can play right away (in the library, or discovery can find it).
    public var available: Bool

    public var code: String { Formatting.episodeCode(season: season, episode: episode) }
}

/// `POST /api/play` (200).
public struct PlayResponse: Codable, Sendable, Hashable {
    public enum Mode: String, Codable, Sendable, Hashable {
        case direct, remux, transcode

        public var isHLS: Bool { self != .direct }
        public var label: String {
            switch self {
            case .direct: "Direct Play"
            case .remux: "Remux (HLS)"
            case .transcode: "Transcode (HLS)"
            }
        }
    }

    public var sessionId: String
    public var mode: Mode
    /// Stream URL; relative as sent by the server, absolute after `StrataClient.play`.
    public var url: URL
    /// Media time at which the stream's t=0 sits (HLS starts at the resume point).
    public var startOffsetMs: Int
    /// Direct play: where to seek after loading (stream time). 0 for HLS.
    public var seekToMs: Int
    public var durationMs: Int
    public var candidate: Candidate
    public var audioTracks: [AudioTrack]
    public var subtitleTracks: [SubtitleTrack]
    public var chapters: [Chapter]
    public var reasons: [String]
    public var nextEpisode: NextEpisode?

    public var duration: TimeInterval { TimeInterval(durationMs) / 1000 }
    public var startOffset: TimeInterval { TimeInterval(startOffsetMs) / 1000 }
    public var selectedAudio: AudioTrack? { audioTracks.first(where: \.selected) ?? audioTracks.first }
}

/// The 202 body of `POST /api/play` while a release downloads on TorBox. Poll by repeating the request.
public struct DownloadingStatus: Codable, Sendable, Hashable {
    /// Always "downloading".
    public var status: String
    public var torrentId: Int
    /// 0...1
    public var progress: Double
    public var etaSeconds: Int?
    public var name: String
    /// Human message from the server ("This release is still downloading on TorBox").
    public var error: String?

    public init(status: String = "downloading", torrentId: Int, progress: Double, etaSeconds: Int?, name: String, error: String? = nil) {
        self.status = status
        self.torrentId = torrentId
        self.progress = progress
        self.etaSeconds = etaSeconds
        self.name = name
        self.error = error
    }

    public var percentText: String { "\(Int((min(1, max(0, progress)) * 100).rounded()))%" }
    public var etaText: String? {
        guard let etaSeconds, etaSeconds > 0 else { return nil }
        if etaSeconds < 60 { return "\(etaSeconds)s left" }
        return Formatting.remaining(ms: etaSeconds * 1000)
    }
}

public enum PlayOutcome: Sendable, Hashable {
    case started(PlayResponse)
    case downloading(DownloadingStatus)
}

/// `POST /api/progress` response.
public typealias ProgressResult = WatchProgress

// MARK: - Language names

public enum LanguageName {
    /// "eng"/"en"/"en-US" → "English" (in the user's locale); passes unknown codes through.
    public static func display(_ code: String) -> String? {
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.lowercased() != "und" else { return nil }
        let base = String(trimmed.split(separator: "-").first ?? Substring(trimmed)).lowercased()
        let two = iso639_2to1[base] ?? base
        return Locale.current.localizedString(forLanguageCode: two) ?? trimmed
    }

    /// Normalised two-letter code for comparisons ("eng" → "en").
    public static func normalized(_ code: String?) -> String? {
        guard let code, !code.isEmpty else { return nil }
        let base = String(code.split(separator: "-").first ?? Substring(code)).lowercased()
        return iso639_2to1[base] ?? (base.count == 2 ? base : base)
    }

    private static let iso639_2to1: [String: String] = [
        "eng": "en", "spa": "es", "fre": "fr", "fra": "fr", "ger": "de", "deu": "de", "ita": "it", "por": "pt",
        "jpn": "ja", "kor": "ko", "chi": "zh", "zho": "zh", "rus": "ru", "hin": "hi", "ara": "ar", "dut": "nl",
        "nld": "nl", "swe": "sv", "nor": "no", "dan": "da", "fin": "fi", "pol": "pl", "tur": "tr", "gre": "el",
        "ell": "el", "heb": "he", "tha": "th", "vie": "vi", "ind": "id", "cze": "cs", "ces": "cs", "hun": "hu",
        "ron": "ro", "rum": "ro", "ukr": "uk", "tam": "ta", "tel": "te", "mal": "ml", "ben": "bn",
    ]
}
