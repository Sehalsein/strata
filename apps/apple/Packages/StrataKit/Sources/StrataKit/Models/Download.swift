import Foundation

/// `POST /api/downloads` (200): the file to download and how to play it once it's here.
public struct DownloadResponse: Codable, Sendable, Hashable {
    public var fileId: Int
    /// The file's link (TorBox), or the server's own address for a file on its disk.
    public var url: URL
    /// `.direct` (an MP4 AVPlayer opens as it is) or `.device` (repackaged on the device).
    public var mode: PlayResponse.Mode
    public var remux: PlayResponse.RemuxPlan?
    public var durationMs: Int
    public var candidate: Candidate
    public var audioTracks: [AudioTrack]
    /// Text tracks inside the file, read as it plays.
    public var subtitleTracks: [SubtitleTrack]
    public var chapters: [Chapter]
}

public enum DownloadOutcome: Sendable, Hashable {
    case ready(DownloadResponse)
    case preparing(PreparingStatus)
    case needsProbe(fileId: Int, url: URL)
}

/// A title downloaded (or downloading) to this device, for the profile that asked for it.
public struct DownloadItem: Codable, Sendable, Hashable, Identifiable {
    public enum State: Codable, Sendable, Hashable {
        case downloading
        case paused
        case failed(String)
        case done
    }

    /// The profile and the title: one download per title per profile.
    public var id: String
    /// The sign-in (profile) it belongs to: only that profile sees and plays it.
    public var signInID: String
    public var target: PlaybackTarget
    public var title: String
    /// e.g. "S1 · E2 · Pilot", or the year for a movie.
    public var subtitle: String?
    public var artworkURL: URL?
    public var response: DownloadResponse
    public var state: State
    public var bytesWritten: Int64
    public var bytesExpected: Int64
    /// The file's name in the downloads folder, once it's complete.
    public var fileName: String?
    public var createdAt: Date
    /// Where it was left, watched offline.
    public var positionMs: Int?

    public init(signInID: String, target: PlaybackTarget, title: String, subtitle: String?, artworkURL: URL?, response: DownloadResponse) {
        self.id = Self.id(signInID: signInID, target: target)
        self.signInID = signInID
        self.target = target
        self.title = title
        self.subtitle = subtitle
        self.artworkURL = artworkURL
        self.response = response
        self.state = .downloading
        self.bytesWritten = 0
        self.bytesExpected = Int64(response.candidate.size)
        self.createdAt = Date()
    }

    public static func id(signInID: String, target: PlaybackTarget) -> String {
        [signInID, target.mediaType.rawValue, String(target.tmdbId), target.season.map(String.init) ?? "", target.episode.map(String.init) ?? ""].joined(separator: ":")
    }

    public var progress: Double {
        guard bytesExpected > 0 else { return 0 }
        return min(1, Double(bytesWritten) / Double(bytesExpected))
    }

    public var isDone: Bool { state == .done }

    /// The file's extension, from the source's name ("mkv" when it has none).
    var fileExtension: String {
        let ext = (response.candidate.name as NSString).pathExtension.lowercased()
        return ext.isEmpty || ext.count > 5 ? "mkv" : ext
    }

    /// What the player needs to play the downloaded file at `fileURL`, from where it was left.
    public func playResponse(fileURL: URL, resumeMs: Int?) -> PlayResponse {
        let start = resumeMs.map { $0 < response.durationMs - 10_000 ? $0 : 0 } ?? 0
        return PlayResponse(sessionId: "offline-\(id)", mode: response.mode, url: fileURL, remux: response.remux,
                            startOffsetMs: 0, seekToMs: start, durationMs: response.durationMs, candidate: response.candidate,
                            audioTracks: response.audioTracks, subtitleTracks: response.subtitleTracks, chapters: response.chapters,
                            reasons: ["Downloaded"], nextEpisode: nil)
    }
}

public extension PlayResponse {
    /// Played from a downloaded file: nothing to tell the server about the session.
    var isOffline: Bool { sessionId.hasPrefix("offline-") }
}
