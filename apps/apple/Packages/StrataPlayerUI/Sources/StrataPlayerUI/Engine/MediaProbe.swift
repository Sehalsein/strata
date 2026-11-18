import Foundation
import AetherEngine

/// What a file holds, in the shape the server's `MediaInfo` has (`apps/server/src/media/probe.ts`).
/// The cloud server can't read files, so the app reads the file's header and sends this
/// instead. Codec names are FFmpeg's, as ffprobe prints them ("hevc", "eac3", "subrip"…),
/// and `index` is the stream's index in the file.
public struct MediaInfo: Codable, Sendable, Equatable {
    public struct Video: Codable, Sendable, Equatable {
        public var index: Int
        public var codec: String
        public var profile: String?
        public var width: Int
        public var height: Int
        /// Frames per second, to 3 decimals.
        public var fps: Double?
        public var bitDepth: Int?
        /// "dv", "hdr10", "hlg", or nil for SDR. Always sent (as null for SDR).
        public var hdr: String?
        public var dvProfile: Int?

        public init(index: Int, codec: String, profile: String? = nil, width: Int, height: Int, fps: Double? = nil,
                    bitDepth: Int? = nil, hdr: String? = nil, dvProfile: Int? = nil) {
            self.index = index
            self.codec = codec
            self.profile = profile
            self.width = width
            self.height = height
            self.fps = fps
            self.bitDepth = bitDepth
            self.hdr = hdr
            self.dvProfile = dvProfile
        }

        private enum CodingKeys: String, CodingKey { case index, codec, profile, width, height, fps, bitDepth, hdr, dvProfile }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(index, forKey: .index)
            try c.encode(codec, forKey: .codec)
            try c.encodeIfPresent(profile, forKey: .profile)
            try c.encode(width, forKey: .width)
            try c.encode(height, forKey: .height)
            try c.encodeIfPresent(fps, forKey: .fps)
            try c.encodeIfPresent(bitDepth, forKey: .bitDepth)
            // The server's type has `hdr` as a required field that is null for SDR.
            try c.encode(hdr, forKey: .hdr)
            try c.encodeIfPresent(dvProfile, forKey: .dvProfile)
        }
    }

    public struct Audio: Codable, Sendable, Equatable {
        public var index: Int
        public var codec: String
        public var channels: Int
        public var language: String?
        public var title: String?
        public var isDefault: Bool
    }

    public struct Subtitle: Codable, Sendable, Equatable {
        public var index: Int
        public var codec: String
        public var language: String?
        public var title: String?
        public var isDefault: Bool
        public var isForced: Bool
        /// Text formats can become WebVTT; bitmap ones (PGS, VobSub) can't.
        public var isText: Bool
    }

    public struct Chapter: Codable, Sendable, Equatable {
        public var startMs: Int
        public var title: String?
    }

    /// "mkv", "webm", "mp4", "mov", "ts", else the first of FFmpeg's names for the format.
    public var container: String
    public var durationMs: Int
    /// Bits per second, if known.
    public var bitrate: Int?
    public var video: Video?
    public var audio: [Audio]
    public var subtitles: [Subtitle]
    public var chapters: [Chapter]
}

/// Reads a file's media info with AetherEngine's probe: the header only, through the same
/// reader that plays it (a few large ranged requests, never a stream of small ones).
public enum MediaProbe {
    /// Subtitle codecs that are text (and so can become WebVTT), as the server lists them.
    static let textSubtitles: Set<String> = ["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]

    /// Reads the media info of a file behind a link (TorBox) or on the device (`file:`).
    /// Fails after `timeout` rather than hanging on a server that doesn't answer.
    public static func probe(url: URL, timeout: TimeInterval = 20) async throws -> MediaInfo {
        let cancellation = ProbeCancellation()
        let limits = ProbeLimits(maxInputBytes: 16 << 20, timeBudget: timeout)
        // Anime MKVs often carry tens of MiB of subtitle fonts ahead of the first frame. The
        // probe only wants tracks and duration, so pass over them, or they eat the byte budget
        // ("Probe input byte limit reached"). Playback still loads them for styled subtitles.
        let options: LoadOptions = {
            var options = LoadOptions()
            options.skipsContainerAttachments = true
            return options
        }()
        return try await withTaskCancellationHandler {
            // The probe blocks on the network: it runs on its own thread, off Swift's pool.
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<MediaInfo, Error>) in
                Thread.detachNewThread {
                    continuation.resume(with: Result {
                        let probe = try AetherEngine.probe(url: url, options: options, limits: limits, cancellation: cancellation)
                        return summarize(probe, path: url.path)
                    })
                }
            }
        } onCancel: {
            cancellation.cancel()
        }
    }

    /// The server's summary (`summarize` in probe.ts) of what the probe read.
    static func summarize(_ p: SourceProbe, path: String) -> MediaInfo {
        let video: MediaInfo.Video? = p.videoWidth > 0 ? MediaInfo.Video(
            // The probe doesn't name the video's stream; it's the first in nearly every file.
            index: 0,
            codec: p.videoCodecName ?? "unknown",
            profile: p.videoStreamFormat?.profile,
            width: Int(p.videoWidth), height: Int(p.videoHeight),
            fps: p.videoFrameRate.map { ($0 * 1000).rounded() / 1000 },
            bitDepth: p.videoStreamFormat?.bitDepth ?? 8,
            hdr: hdr(p),
            dvProfile: p.isDolbyVision ? p.dvProfile : nil
        ) : nil
        let audio = p.audioTracks.map {
            MediaInfo.Audio(index: $0.id, codec: $0.codec, channels: $0.channels > 0 ? $0.channels : 2,
                            language: language($0.language), title: title($0), isDefault: $0.isDefault)
        }
        let subtitles = p.subtitleTracks.filter { !$0.isExternal }.map {
            MediaInfo.Subtitle(index: $0.id, codec: $0.codec, language: language($0.language), title: title($0),
                               isDefault: $0.isDefault, isForced: $0.isForced, isText: textSubtitles.contains($0.codec))
        }
        return MediaInfo(
            container: container(formatName: p.containerFormat ?? "", path: path),
            durationMs: p.durationSeconds > 0 ? Int((p.durationSeconds * 1000).rounded()) : 0,
            bitrate: nil,
            video: video,
            audio: audio,
            subtitles: subtitles,
            chapters: []
        )
    }

    private static func hdr(_ p: SourceProbe) -> String? {
        if p.isDolbyVision { return "dv" }
        switch p.videoFormat {
        case .dolbyVision: return "dv"
        case .hdr10, .hdr10Plus: return "hdr10"
        case .hlg: return "hlg"
        case .sdr: return nil
        }
    }

    /// "mkv" (or "webm"), "mp4" (or "mov"), "ts", else FFmpeg's first name for the format.
    static func container(formatName: String, path: String) -> String {
        let path = path.lowercased()
        if formatName.contains("matroska") { return path.hasSuffix(".webm") ? "webm" : "mkv" }
        if formatName.contains("mp4") || formatName.contains("mov") { return path.hasSuffix(".mov") ? "mov" : "mp4" }
        if formatName.contains("mpegts") { return "ts" }
        return formatName.split(separator: ",").first.map(String.init) ?? "unknown"
    }

    private static func language(_ code: String?) -> String? {
        guard let code, !code.isEmpty, code != "und" else { return nil }
        return code
    }

    /// The track's own title, not the one the engine makes up without it
    /// ("ENG (aac)", "Track 2 (subrip)").
    private static func title(_ track: TrackInfo) -> String? {
        let name = track.name.trimmingCharacters(in: .whitespaces)
        let madeUp = ["\((track.language ?? "").uppercased()) (\(track.codec))", "Track \(track.id) (\(track.codec))"]
        return name.isEmpty || madeUp.contains(name) ? nil : name
    }
}
