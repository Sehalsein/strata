import Foundation
import FFmpeg

/// Plays a file AVPlayer can't open by itself (MKV, DTS, TrueHD…) by repackaging it on the
/// device: the file is read straight from its link (or from disk, for downloads), cut
/// into fragmented-MP4 HLS segments as the player asks for them, and served from
/// 127.0.0.1. Give AVPlayer `playlistURL` once `start()` returns.
public final class RemuxSession: @unchecked Sendable {
    public enum Source: Sendable {
        /// A link (TorBox). `refresh` returns a new one when it stops working.
        case remote(URL, refresh: (@Sendable () async throws -> URL)?)
        /// A downloaded file.
        case file(URL)
    }

    /// A text subtitle stream offered to the player as a WebVTT track, so Apple's player
    /// draws it itself: in Picture in Picture and on AirPlay too.
    public struct SubtitleRendition: Sendable, Hashable {
        public var streamIndex: Int32
        public var name: String
        /// BCP 47 / ISO 639 code, if known.
        public var language: String?
        public var isDefault: Bool
        public var forced: Bool

        public init(streamIndex: Int32, name: String, language: String? = nil, isDefault: Bool = false, forced: Bool = false) {
            self.streamIndex = streamIndex
            self.name = name
            self.language = language
            self.isDefault = isDefault
            self.forced = forced
        }
    }

    /// What Stream Details shows.
    public struct Stats: Sendable {
        public var segments: Int
        public var bytesFetched: Int64
        public var audio: RemuxPlan.Audio
    }

    private let source: Source
    private let plan: RemuxPlan
    /// FFmpeg work (and the blocking reads behind it) runs here, one segment at a time.
    private let work = DispatchQueue(label: "strata.remux.segments", qos: .userInitiated)
    private var byteSource: ByteSource?
    private var segmenter: Segmenter?
    private var server: LoopbackServer?
    private var cache: [Int: Data] = [:]
    private var cacheOrder: [Int] = []
    private let lock = NSLock()
    private var seenCues = Set<SubtitleCue>()
    /// Lines read so far, by stream, for the WebVTT tracks.
    private var cuesByStream: [Int32: [SubtitleCue]] = [:]
    /// Segments whose packets (and so subtitle lines) have been read.
    private var builtSegments = Set<Int>()
    /// Text subtitle streams to offer as WebVTT tracks. Set before `start()`.
    public var subtitleRenditions: [SubtitleRendition] = []
    public private(set) var playlistURL: URL?
    /// Called on an arbitrary thread with new subtitle lines as segments are read.
    public var onCues: (@Sendable ([SubtitleCue]) -> Void)?

    public init(source: Source, plan: RemuxPlan) {
        self.source = source
        self.plan = plan
    }

    deinit { stop() }

    /// Opens the file, reads its index and starts the loopback server.
    public func start() async throws -> URL {
        let segmenter = try await onWorkQueue { () throws -> Segmenter in
            let bytes: ByteSource
            switch self.source {
            case .remote(let url, let refresh): bytes = try HTTPByteSource(url: url, refresh: refresh)
            case .file(let url): bytes = try FileByteSource(url: url)
            }
            self.byteSource = bytes
            let demuxer = try Demuxer(source: bytes, videoIndex: self.plan.videoStreamIndex)
            let segmenter = try Segmenter(demuxer: demuxer, plan: self.plan)
            segmenter.onCues = { [weak self] cues in self?.deliver(cues) }
            // The header first: it fails fast on anything the writer can't take.
            _ = try segmenter.initSegment()
            self.markBuilt(0)
            return segmenter
        }
        self.segmenter = segmenter
        let server = try LoopbackServer { [weak self] path in await self?.respond(to: path) }
        let port = try await server.start()
        self.server = server
        let url = URL(string: "http://127.0.0.1:\(port)/index.m3u8")!
        playlistURL = url
        return url
    }

    public func stop() {
        server?.stop()
        server = nil
        byteSource?.close()
    }

    public var stats: Stats {
        Stats(segments: segmenter?.segmentCount ?? 0, bytesFetched: (byteSource as? HTTPByteSource)?.bytesFetched ?? 0, audio: plan.audio)
    }

    /// With subtitle tracks, a master playlist naming the video and each WebVTT track;
    /// without, the video playlist itself.
    func masterPlaylist() -> String {
        guard let segmenter, !subtitleRenditions.isEmpty else { return playlist() }
        let seconds = max(1, segmenter.boundaries.last ?? 1)
        let bandwidth = max(1_000_000, Int(Double(byteSource?.size ?? 0) * 8 / seconds))
        var lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]
        for r in subtitleRenditions {
            var attributes = [
                "TYPE=SUBTITLES", "GROUP-ID=\"subs\"", "NAME=\"\(Self.quoted(r.name))\"",
                "DEFAULT=\(r.isDefault ? "YES" : "NO")", "AUTOSELECT=YES", "FORCED=\(r.forced ? "YES" : "NO")",
            ]
            if let language = r.language, !language.isEmpty { attributes.append("LANGUAGE=\"\(Self.quoted(language))\"") }
            attributes.append("URI=\"subs\(r.streamIndex).m3u8\"")
            lines.append("#EXT-X-MEDIA:" + attributes.joined(separator: ","))
        }
        lines.append("#EXT-X-STREAM-INF:BANDWIDTH=\(bandwidth),\(videoAttributes(segmenter))SUBTITLES=\"subs\"")
        lines.append("video.m3u8")
        return lines.joined(separator: "\n") + "\n"
    }

    /// RESOLUTION, FRAME-RATE and VIDEO-RANGE for the master playlist. HDR must be declared
    /// there: without VIDEO-RANGE=PQ the player took an HDR10 file for SDR and refused it.
    private func videoAttributes(_ segmenter: Segmenter) -> String {
        let video = segmenter.demuxer.stream(segmenter.demuxer.videoIndex).pointee
        let par = video.codecpar.pointee
        var out = ""
        if par.width > 0, par.height > 0 { out += "RESOLUTION=\(par.width)x\(par.height)," }
        let rate = video.avg_frame_rate.num > 0 && video.avg_frame_rate.den > 0 ? video.avg_frame_rate : video.r_frame_rate
        if rate.num > 0, rate.den > 0 { out += String(format: "FRAME-RATE=%.3f,", Double(rate.num) / Double(rate.den)) }
        if let range = plan.videoRange { return out + "VIDEO-RANGE=\(range)," }
        switch par.color_trc {
        case AVCOL_TRC_SMPTE2084: out += "VIDEO-RANGE=PQ,"
        case AVCOL_TRC_ARIB_STD_B67: out += "VIDEO-RANGE=HLG,"
        default:
            // Dolby Vision profile 5 carries no HDR10 transfer flag but is PQ all the same.
            out += Self.hasDolbyVision(video) ? "VIDEO-RANGE=PQ," : "VIDEO-RANGE=SDR,"
        }
        return out
    }

    private static func hasDolbyVision(_ stream: AVStream) -> Bool {
        let par = stream.codecpar.pointee
        for i in 0..<Int(par.nb_coded_side_data) where par.coded_side_data[i].type == AV_PKT_DATA_DOVI_CONF { return true }
        return false
    }

    private static func quoted(_ value: String) -> String {
        value.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\n", with: " ")
    }

    /// One WebVTT track: a file per video segment, so the player fetches lines alongside
    /// the video it plays.
    func subtitlePlaylist(stream: Int32) -> String {
        guard let segmenter else { return "" }
        let durations = (0..<segmenter.segmentCount).map(segmenter.duration(of:))
        var lines = [
            "#EXTM3U", "#EXT-X-VERSION:7",
            "#EXT-X-TARGETDURATION:\(Int((durations.max() ?? Segmenter.targetSeconds).rounded(.up)))",
            "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD",
        ]
        for (i, d) in durations.enumerated() {
            lines.append(String(format: "#EXTINF:%.6f,", d))
            lines.append(String(format: "subs%d_%05d.vtt", stream, i))
        }
        lines.append("#EXT-X-ENDLIST")
        return lines.joined(separator: "\n") + "\n"
    }

    /// The lines showing during segment `n`, as WebVTT. Reading the segment is what finds
    /// them, so it's built first if the player hasn't asked for its video yet.
    func subtitleSegment(stream: Int32, index n: Int) async -> String {
        guard let segmenter, n >= 0, n < segmenter.segmentCount else { return "" }
        if !isBuilt(n) { _ = await segment(n) }
        let from = segmenter.boundaries[n], to = segmenter.boundaries[n + 1]
        let cues = cues(stream, from: from, to: to)
        // The video's timestamps run `timelineShift` ahead of the file's; the map ties the
        // cues' times (the file's) to them.
        let shift = Int(Segmenter.timelineShift * 90_000)
        var out = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:\(shift),LOCAL:00:00:00.000\n\n"
        for cue in cues.sorted(by: { $0.start < $1.start }) {
            let text = cue.text.split(separator: "\n", omittingEmptySubsequences: true).joined(separator: "\n")
            guard !text.isEmpty else { continue }
            out += "\(Self.vttTime(cue.start)) --> \(Self.vttTime(cue.end))\n\(text)\n\n"
        }
        return out
    }

    static func vttTime(_ seconds: Double) -> String {
        let ms = Int((max(0, seconds) * 1000).rounded())
        return String(format: "%02d:%02d:%02d.%03d", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)
    }

    /// The whole-file VOD playlist: every segment is known up front, so AVPlayer can seek
    /// anywhere and knows the duration.
    func playlist() -> String {
        guard let segmenter else { return "" }
        let durations = (0..<segmenter.segmentCount).map(segmenter.duration(of:))
        var lines = [
            "#EXTM3U",
            "#EXT-X-VERSION:7",
            "#EXT-X-TARGETDURATION:\(Int((durations.max() ?? Segmenter.targetSeconds).rounded(.up)))",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXT-X-PLAYLIST-TYPE:VOD",
            "#EXT-X-INDEPENDENT-SEGMENTS",
            "#EXT-X-MAP:URI=\"init.mp4\"",
        ]
        for (i, d) in durations.enumerated() {
            lines.append(String(format: "#EXTINF:%.6f,", d))
            lines.append(String(format: "seg%05d.m4s", i))
        }
        lines.append("#EXT-X-ENDLIST")
        return lines.joined(separator: "\n") + "\n"
    }

    private func respond(to path: String) async -> (Data, String)? {
        let name = path.split(separator: "?").first.map { String($0.dropFirst()) } ?? ""
        let m3u8 = "application/vnd.apple.mpegurl"
        if name == "index.m3u8" { return (Data(masterPlaylist().utf8), m3u8) }
        if name == "video.m3u8" { return (Data(playlist().utf8), m3u8) }
        if name.hasPrefix("subs") {
            let body = name.dropFirst(4)
            if body.hasSuffix(".m3u8"), let stream = Int32(body.dropLast(5)) {
                return (Data(subtitlePlaylist(stream: stream).utf8), m3u8)
            }
            let parts = body.dropLast(4).split(separator: "_")
            if body.hasSuffix(".vtt"), parts.count == 2, let stream = Int32(parts[0]), let n = Int(parts[1]) {
                return (Data(await subtitleSegment(stream: stream, index: n).utf8), "text/vtt")
            }
            return nil
        }
        if name == "init.mp4" {
            return (try? await onWorkQueue { try self.segmenter!.initSegment() }).map { ($0, "video/mp4") }
        }
        guard name.hasPrefix("seg"), name.hasSuffix(".m4s"), let n = Int(name.dropFirst(3).dropLast(4)),
              let segmenter, n >= 0, n < segmenter.segmentCount else { return nil }
        guard let data = await segment(n) else { return nil }
        // The player will want the next one soon.
        if n + 1 < segmenter.segmentCount { Task { _ = await self.segment(n + 1) } }
        return (data, "video/iso.segment")
    }

    private func segment(_ n: Int) async -> Data? {
        if let hit = cached(n) { return hit }
        guard let data = try? await onWorkQueue({ () throws -> Data in
            if let hit = self.cached(n) { return hit }
            return try self.segmenter!.mediaSegment(n)
        }) else { return nil }
        markBuilt(n)
        store(n, data)
        return data
    }

    private func cached(_ n: Int) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return cache[n]
    }

    /// Keeps the last few segments (the player re-asks after a stall or a short seek back).
    private func store(_ n: Int, _ data: Data) {
        lock.lock(); defer { lock.unlock() }
        cache[n] = data
        cacheOrder.removeAll { $0 == n }
        cacheOrder.append(n)
        while cacheOrder.count > 4 { cache.removeValue(forKey: cacheOrder.removeFirst()) }
    }

    private func cues(_ stream: Int32, from: Double, to: Double) -> [SubtitleCue] {
        lock.lock(); defer { lock.unlock() }
        return (cuesByStream[stream] ?? []).filter { $0.end > from && $0.start < to }
    }

    private func markBuilt(_ n: Int) {
        lock.lock(); builtSegments.insert(n); lock.unlock()
    }

    private func isBuilt(_ n: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return builtSegments.contains(n)
    }

    private func deliver(_ cues: [SubtitleCue]) {
        lock.lock()
        let fresh = cues.filter { seenCues.insert($0).inserted }
        for cue in fresh { cuesByStream[cue.streamIndex, default: []].append(cue) }
        lock.unlock()
        if !fresh.isEmpty { onCues?(fresh) }
    }

    private func onWorkQueue<T>(_ body: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            work.async { continuation.resume(with: Result { try body() }) }
        }
    }
}
