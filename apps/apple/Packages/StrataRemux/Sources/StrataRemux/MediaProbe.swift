import Foundation
import FFmpeg

/// What a file holds, in the shape the server's `MediaInfo` has (`apps/server/src/media/probe.ts`):
/// the server used to learn this by running ffprobe on the link; it can't run programs
/// any more, so the app reads the file's header and sends this instead. Codec names are
/// FFmpeg's, as ffprobe prints them ("hevc", "eac3", "subrip"…), and `index` is the
/// stream's index in the file.
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

public enum MediaProbe {
    /// Subtitle codecs that are text (and so can become WebVTT), as the server lists them.
    static let textSubtitles: Set<String> = ["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]

    /// Reads the media info of a file behind a link (TorBox) or on the device (`file:`).
    /// Only the header is read: a few ranged requests, not the whole file. `refresh`
    /// replaces a link that stopped working, as in `RemuxSession`. Fails after `timeout`
    /// rather than hanging on a stalled server.
    public static func probe(url: URL, refresh: (@Sendable () async throws -> URL)? = nil,
                             timeout: TimeInterval = 20) async throws -> MediaInfo {
        let job = ProbeJob()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                job.begin(continuation)
                // The reads block, so they run on their own queue, never on Swift's pool.
                DispatchQueue(label: "strata.remux.probe", qos: .userInitiated).async {
                    job.finish(Result { try read(url: url, refresh: refresh, job: job) })
                }
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                    job.finish(.failure(RemuxError.network("The file server took too long to answer.")))
                }
            }
        } onCancel: {
            job.finish(.failure(CancellationError()))
        }
    }

    /// Opens the file and reads its header (on the probe's queue).
    private static func read(url: URL, refresh: (@Sendable () async throws -> URL)?, job: ProbeJob) throws -> MediaInfo {
        let source: ByteSource = url.isFileURL ? try FileByteSource(url: url) : try HTTPByteSource(url: url, refresh: refresh)
        // A probe that timed out or was cancelled while the first block loaded.
        guard job.adopt(source) else { throw CancellationError() }
        defer { source.close() }
        let io = try IOBridge(source: source)
        var format: UnsafeMutablePointer<AVFormatContext>? = try Demuxer.open(io)
        defer { avformat_close_input(&format) }
        return summarize(format!, path: url.path)
    }

    /// The server's summary (`summarize` in probe.ts) of what FFmpeg read.
    static func summarize(_ format: UnsafeMutablePointer<AVFormatContext>, path: String) -> MediaInfo {
        let f = format.pointee
        let streams = (0..<Int(f.nb_streams)).map { f.streams[$0]!.pointee }
        let video = streams.first { $0.codecpar.pointee.codec_type == AVMEDIA_TYPE_VIDEO && $0.disposition & AV_DISPOSITION_ATTACHED_PIC == 0 }

        var audio: [MediaInfo.Audio] = []
        var subtitles: [MediaInfo.Subtitle] = []
        for st in streams {
            let par = st.codecpar.pointee
            let codec = codecName(par.codec_id)
            if par.codec_type == AVMEDIA_TYPE_AUDIO {
                let channels = par.ch_layout.nb_channels
                audio.append(.init(index: Int(st.index), codec: codec, channels: channels > 0 ? Int(channels) : 2,
                                   language: language(st), title: tag(st.metadata, "title"),
                                   isDefault: st.disposition & AV_DISPOSITION_DEFAULT != 0))
            } else if par.codec_type == AVMEDIA_TYPE_SUBTITLE {
                subtitles.append(.init(index: Int(st.index), codec: codec, language: language(st), title: tag(st.metadata, "title"),
                                       isDefault: st.disposition & AV_DISPOSITION_DEFAULT != 0,
                                       isForced: st.disposition & AV_DISPOSITION_FORCED != 0,
                                       isText: textSubtitles.contains(codec)))
            }
        }

        let chapters = (0..<Int(f.nb_chapters)).map { i -> MediaInfo.Chapter in
            let c = f.chapters[i]!.pointee
            return .init(startMs: Int((Double(c.start) * c.time_base.seconds * 1000).rounded()), title: tag(c.metadata, "title"))
        }

        return MediaInfo(
            container: container(formatName: f.iformat.map { String(cString: $0.pointee.name) } ?? "", path: path),
            durationMs: f.duration > 0 ? Int((Double(f.duration) / Double(AV_TIME_BASE) * 1000).rounded()) : 0,
            bitrate: f.bit_rate > 0 ? Int(f.bit_rate) : nil,
            video: video.map(summarizeVideo),
            audio: audio,
            subtitles: subtitles,
            chapters: chapters
        )
    }

    private static func summarizeVideo(_ st: AVStream) -> MediaInfo.Video {
        let par = st.codecpar.pointee
        let dv = av_packet_side_data_get(par.coded_side_data, par.nb_coded_side_data, AV_PKT_DATA_DOVI_CONF)
        let hdr: String?
        var dvProfile: Int?
        if let dv, dv.pointee.size >= MemoryLayout<AVDOVIDecoderConfigurationRecord>.size {
            hdr = "dv"
            dvProfile = dv.pointee.data.withMemoryRebound(to: AVDOVIDecoderConfigurationRecord.self, capacity: 1) { Int($0.pointee.dv_profile) }
        } else {
            var transfer = par.color_trc
            // FFmpeg reads H.264's colour description only when decoding (see H264VUI).
            if transfer == AVCOL_TRC_UNSPECIFIED, par.codec_id == AV_CODEC_ID_H264, let vui = h264VUI(par),
               let declared = vui.transfer {
                transfer = AVColorTransferCharacteristic(UInt32(declared))
            }
            switch transfer {
            case AVCOL_TRC_SMPTE2084: hdr = "hdr10"
            case AVCOL_TRC_ARIB_STD_B67: hdr = "hlg"
            default: hdr = nil
            }
        }
        let rate = st.avg_frame_rate
        let fps = rate.num > 0 && rate.den > 0 ? (Double(rate.num) / Double(rate.den) * 1000).rounded() / 1000 : nil
        // ffprobe's bits_per_raw_sample, else the pixel format's depth (the server guessed
        // 10 from the format's name, else 8).
        var bitDepth = Int(par.bits_per_raw_sample)
        if bitDepth <= 0, par.format >= 0, let desc = av_pix_fmt_desc_get(AVPixelFormat(par.format)) {
            bitDepth = Int(desc.pointee.comp.0.depth)
        }
        if bitDepth <= 0, par.codec_id == AV_CODEC_ID_H264, let vui = h264VUI(par) { bitDepth = vui.bitDepth }
        if bitDepth <= 0, par.codec_id == AV_CODEC_ID_AV1, let depth = av1BitDepth(par) { bitDepth = depth }
        return MediaInfo.Video(
            index: Int(st.index), codec: codecName(par.codec_id),
            profile: avcodec_profile_name(par.codec_id, par.profile).map { String(cString: $0) },
            width: Int(par.width), height: Int(par.height), fps: fps,
            bitDepth: bitDepth > 0 ? bitDepth : 8, hdr: hdr, dvProfile: dvProfile
        )
    }

    /// "mkv" (or "webm"), "mp4" (or "mov"), "ts", else FFmpeg's first name for the format.
    static func container(formatName: String, path: String) -> String {
        let path = path.lowercased()
        if formatName.contains("matroska") { return path.hasSuffix(".webm") ? "webm" : "mkv" }
        if formatName.contains("mp4") || formatName.contains("mov") { return path.hasSuffix(".mov") ? "mov" : "mp4" }
        if formatName.contains("mpegts") { return "ts" }
        return formatName.split(separator: ",").first.map(String.init) ?? "unknown"
    }

    private static func h264VUI(_ par: AVCodecParameters) -> H264VUI? {
        guard let extradata = par.extradata, par.extradata_size > 0 else { return nil }
        return H264VUI(extradata: Data(bytes: extradata, count: Int(par.extradata_size)))
    }

    /// The AV1 parser reads the depth but it doesn't reach the stream's parameters; the
    /// `av1C` record (MKV, MP4) has it in its third byte: high_bitdepth, then twelve_bit.
    private static func av1BitDepth(_ par: AVCodecParameters) -> Int? {
        guard let extradata = par.extradata, par.extradata_size >= 4, extradata[0] & 0x80 != 0 else { return nil }
        let flags = extradata[2]
        guard flags & 0x40 != 0 else { return 8 }
        return flags & 0x20 != 0 ? 12 : 10
    }

    private static func codecName(_ id: AVCodecID) -> String {
        avcodec_get_name(id).map { String(cString: $0) } ?? "unknown"
    }

    private static func language(_ st: AVStream) -> String? {
        guard let lang = tag(st.metadata, "language"), lang != "und" else { return nil }
        return lang
    }

    private static func tag(_ dict: OpaquePointer?, _ key: String) -> String? {
        guard let entry = av_dict_get(dict, key, nil, 0), let value = entry.pointee.value else { return nil }
        let s = String(cString: value)
        return s.isEmpty ? nil : s
    }
}

/// One probe's state across its queue, the timeout and cancellation: whichever finishes
/// first answers, and closing the source unblocks a read still waiting on the network.
private final class ProbeJob: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<MediaInfo, Error>?
    private var source: ByteSource?
    private var done = false

    func begin(_ continuation: CheckedContinuation<MediaInfo, Error>) {
        lock.lock()
        if done {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    /// Keeps the open source so a timeout can close it; false if the probe already ended.
    func adopt(_ source: ByteSource) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if done { source.close(); return false }
        self.source = source
        return true
    }

    func finish(_ result: Result<MediaInfo, Error>) {
        lock.lock()
        guard !done else { lock.unlock(); return }
        done = true
        let continuation = self.continuation
        let source = self.source
        self.continuation = nil
        lock.unlock()
        source?.close()
        continuation?.resume(with: result)
    }
}
