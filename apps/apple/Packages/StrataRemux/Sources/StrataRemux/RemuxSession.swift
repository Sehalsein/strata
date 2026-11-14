import Foundation
import FFmpeg
import Security
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "strata", category: "remux")

func remuxLog(_ message: String) {
    logger.warning("\(message, privacy: .public)")
}

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

    /// The video as the file has it: what an Apple TV switches its display mode to.
    public struct VideoFormat: Sendable, Equatable {
        public enum Codec: Sendable { case h264, hevc, av1, other }
        public var width: Int
        public var height: Int
        public var frameRate: Double?
        public var codec: Codec
        /// "PQ" (HDR10, Dolby Vision), "HLG" or "SDR".
        public var range: String
        /// Dolby Vision kept (not stripped to its HDR10 base layer).
        public var dolbyVision: Bool
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
    /// For AirPlay: the same stream on the Wi-Fi address, under a secret path.
    private var networkServer: LoopbackServer?
    private var networkURL: URL?
    private var cache: [Int: Data] = [:]
    private var cacheOrder: [Int] = []
    private let lock = NSLock()
    /// Segments waiting to be built, and the one being built (all under `lock`).
    private var jobs: [Job] = []
    private var building: Job?
    /// The segment the player asked for last: where playback is. Builds for segments far
    /// from it (a scrub moved on) are dropped, or stopped part way, so the one the player
    /// waits for now never queues behind them.
    private var playhead = 0
    /// Where playback starts (media seconds): the header is built with that segment, and the
    /// playlists tell the player to begin there rather than at 0.
    private var startSeconds: Double = 0
    /// The header (ftyp + moov), built in `start()`.
    private var initData: Data?
    private var seenCues = Set<SubtitleCue>()
    /// Lines read so far, by stream, for the WebVTT tracks.
    private var cuesByStream: [Int32: [SubtitleCue]] = [:]
    /// Segments whose packets (and so subtitle lines) have been read.
    private var builtSegments = Set<Int>()
    /// Text subtitle streams to offer as WebVTT tracks. Set before `start()`.
    public var subtitleRenditions: [SubtitleRendition] = []
    public private(set) var playlistURL: URL?
    /// The video's format, known once `start()` returns.
    public private(set) var videoFormat: VideoFormat?
    /// Called on an arbitrary thread with new subtitle lines as segments are read.
    public var onCues: (@Sendable ([SubtitleCue]) -> Void)?
    /// Called on an arbitrary thread when the loopback server fails after it started (the
    /// system can take it down while the app is suspended): the stream needs reopening.
    public var onServerLost: (@Sendable () -> Void)?
    /// Set by `stop()` (under `lock`): nothing more is built or answered.
    private var stopped = false

    public init(source: Source, plan: RemuxPlan) {
        self.source = source
        self.plan = plan
    }

    deinit { stop() }

    /// Opens the file, reads its index and starts the loopback server. `at` (media seconds)
    /// is where playback will begin: that segment is built first and the next one after it,
    /// so a resume doesn't wait for the start of the file and then a seek.
    public func start(at seconds: Double = 0) async throws -> URL {
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
            let first = segmenter.segment(at: seconds)
            self.initData = try segmenter.initSegment(from: first)
            self.markBuilt(first)
            return segmenter
        }
        // Stopped while the file was opening: `stop()` may have run before there was a source.
        guard !isStopped else { closeSource(); throw CancellationError() }
        self.segmenter = segmenter
        let first = segmenter.segment(at: seconds)
        startSeconds = first > 0 ? max(0, seconds) : 0
        lock.withLock { playhead = first }
        if first + 1 < segmenter.segmentCount { Task { _ = await self.segment(first + 1, for: .prefetch) } }
        videoFormat = Self.videoFormat(segmenter, plan: plan)
        let server = try LoopbackServer { [weak self] path in await self?.respond(to: path) ?? .notFound }
        server.onFailure = { [weak self] in self?.onServerLost?() }
        let port = try await server.start()
        guard !isStopped else { server.stop(); throw CancellationError() }
        self.server = server
        let url = URL(string: "http://127.0.0.1:\(port)/index.m3u8")!
        playlistURL = url
        return url
    }

    /// The stream at this device's Wi-Fi address, for an Apple TV on AirPlay (it can't
    /// reach 127.0.0.1 here). Every path sits under a random 128-bit token, so nothing
    /// else on the network can guess its way in. Started on first use; stops with `stop()`.
    public func networkPlaylistURL() async throws -> URL {
        if let networkURL { return networkURL }
        guard let address = WiFiAddress.current() else { throw URLError(.notConnectedToInternet) }
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw URLError(.cannotCreateFile) }
        let token = bytes.map { String(format: "%02x", $0) }.joined()
        let prefix = "/\(token)/"
        let server = try LoopbackServer(loopbackOnly: false) { [weak self] path in
            guard path.hasPrefix(prefix) else { return .notFound }
            return await self?.respond(to: "/" + path.dropFirst(prefix.count)) ?? .notFound
        }
        let port = try await server.start()
        guard !isStopped else { server.stop(); throw CancellationError() }
        networkServer = server
        let url = URL(string: "http://\(address):\(port)\(prefix)index.m3u8")!
        networkURL = url
        return url
    }

    /// The loopback server is up and answering.
    public var isServing: Bool { server?.isListening ?? false }

    private var isStopped: Bool { lock.withLock { stopped } }

    public func stop() {
        lock.lock()
        stopped = true
        let waiting = jobs
        jobs = []
        playhead = Int.min / 2 // anything being built is now stale and stops
        lock.unlock()
        for job in waiting { job.waiters.forEach { $0.resume(returning: nil) } }
        server?.stop()
        server = nil
        networkServer?.stop()
        networkServer = nil
        networkURL = nil
        closeSource()
    }

    private func closeSource() {
        if let file = byteSource as? FileByteSource {
            // Closed after any read under way on the work queue: closing it here could let
            // the descriptor be reused by another file while a pread is still using it.
            work.async { file.close() }
        } else {
            // Wakes a read waiting on the network (it fails) rather than queueing behind it.
            byteSource?.close()
        }
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
        if let start = startTag { lines.append(start) }
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
        let format = Self.videoFormat(segmenter, plan: plan)
        var out = ""
        if format.width > 0, format.height > 0 { out += "RESOLUTION=\(format.width)x\(format.height)," }
        if let rate = format.frameRate { out += String(format: "FRAME-RATE=%.3f,", rate) }
        return out + "VIDEO-RANGE=\(format.range),"
    }

    /// What the video is, read from the file's header.
    static func videoFormat(_ segmenter: Segmenter, plan: RemuxPlan) -> VideoFormat {
        let video = segmenter.demuxer.stream(segmenter.demuxer.videoIndex).pointee
        let par = video.codecpar.pointee
        let rate = video.avg_frame_rate.num > 0 && video.avg_frame_rate.den > 0 ? video.avg_frame_rate : video.r_frame_rate
        let dolbyVision = !plan.stripDolbyVision && hasDolbyVision(video)
        let range: String
        if let known = plan.videoRange {
            range = known
        } else {
            switch par.color_trc {
            case AVCOL_TRC_SMPTE2084: range = "PQ"
            case AVCOL_TRC_ARIB_STD_B67: range = "HLG"
            // Dolby Vision profile 5 carries no HDR10 transfer flag but is PQ all the same.
            default: range = hasDolbyVision(video) ? "PQ" : "SDR"
            }
        }
        let codec: VideoFormat.Codec = switch par.codec_id {
        case AV_CODEC_ID_HEVC: .hevc
        case AV_CODEC_ID_H264: .h264
        case AV_CODEC_ID_AV1: .av1
        default: .other
        }
        return VideoFormat(width: Int(par.width), height: Int(par.height),
                           frameRate: rate.num > 0 && rate.den > 0 ? Double(rate.num) / Double(rate.den) : nil,
                           codec: codec, range: range, dolbyVision: dolbyVision)
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
        if !isBuilt(n) { _ = await segment(n, for: .subtitles) }
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
        if let start = startTag { lines.insert(start, at: 6) }
        for (i, d) in durations.enumerated() {
            lines.append(String(format: "#EXTINF:%.6f,", d))
            lines.append(String(format: "seg%05d.m4s", i))
        }
        lines.append("#EXT-X-ENDLIST")
        return lines.joined(separator: "\n") + "\n"
    }

    /// Has the player begin at the resume point, so it never fetches the start of the file.
    private var startTag: String? {
        startSeconds > 0 ? String(format: "#EXT-X-START:TIME-OFFSET=%.3f,PRECISE=YES", startSeconds) : nil
    }

    private func respond(to path: String) async -> LoopbackServer.Reply {
        guard !isStopped else { return .unavailable }
        let name = path.split(separator: "?").first.map { String($0.dropFirst()) } ?? ""
        let m3u8 = "application/vnd.apple.mpegurl"
        if name == "index.m3u8" { return .ok(Data(masterPlaylist().utf8), m3u8) }
        if name == "video.m3u8" { return .ok(Data(playlist().utf8), m3u8) }
        if name.hasPrefix("subs") {
            let body = name.dropFirst(4)
            if body.hasSuffix(".m3u8"), let stream = Int32(body.dropLast(5)) {
                return .ok(Data(subtitlePlaylist(stream: stream).utf8), m3u8)
            }
            let parts = body.dropLast(4).split(separator: "_")
            if body.hasSuffix(".vtt"), parts.count == 2, let stream = Int32(parts[0]), let n = Int(parts[1]) {
                return .ok(Data(await subtitleSegment(stream: stream, index: n).utf8), "text/vtt")
            }
            return .notFound
        }
        if name == "init.mp4" {
            // Built in `start()`: answered at once, not behind a segment being built.
            guard let initData else { return .notFound }
            return .ok(initData, "video/mp4")
        }
        guard name.hasPrefix("seg"), name.hasSuffix(".m4s"), let n = Int(name.dropFirst(3).dropLast(4)),
              let segmenter, n >= 0, n < segmenter.segmentCount else { return .notFound }
        switch await segment(n, for: .player) {
        case .some(let data):
            // The player will want the next one soon.
            if n + 1 < segmenter.segmentCount { Task { _ = await self.segment(n + 1, for: .prefetch) } }
            return .ok(data, "video/iso.segment")
        case .none:
            // Dropped for a newer request, or the read failed: the player asks again.
            return .unavailable
        }
    }

    // MARK: - Building segments

    enum Purpose {
        /// The player is waiting for it: it moves the playhead.
        case player
        /// Built ahead of the player; dropped when it's no longer near the playhead.
        case prefetch
        /// Read for its subtitle lines; never dropped, and doesn't move the playhead.
        case subtitles
    }

    private final class Job {
        let index: Int
        var purpose: Purpose
        var waiters: [CheckedContinuation<Data?, Never>] = []
        init(index: Int, purpose: Purpose) {
            self.index = index
            self.purpose = purpose
        }
    }

    /// A segment's media, built once however many ask for it. Nil when it was dropped as
    /// stale or couldn't be read.
    func segment(_ n: Int, for purpose: Purpose) async -> Data? {
        guard !isStopped else { return nil }
        if let hit = cached(n) {
            if purpose == .player { lock.withLock { playhead = n } }
            return hit
        }
        return await withCheckedContinuation { (continuation: CheckedContinuation<Data?, Never>) in
            lock.lock()
            // Stopped since the check above: `stop()` already answered everyone waiting.
            if stopped {
                lock.unlock()
                continuation.resume(returning: nil)
                return
            }
            if purpose == .player { playhead = n }
            if let job = (building?.index == n ? building : nil) ?? jobs.first(where: { $0.index == n }) {
                job.waiters.append(continuation)
                if purpose != .prefetch { job.purpose = purpose }
            } else {
                let job = Job(index: n, purpose: purpose)
                job.waiters.append(continuation)
                jobs.append(job)
            }
            let idle = building == nil
            lock.unlock()
            if idle { work.async { self.drain() } }
        }
    }

    /// Whether a segment is too far from the playhead to be worth building (lock held).
    private func isStale(_ job: Job) -> Bool {
        // After `stop()` everything is, subtitle reads too.
        if stopped { return true }
        guard job.purpose != .subtitles else { return false }
        return job.index < playhead - 1 || job.index > playhead + 3
    }

    /// Builds queued segments one at a time on the work queue: what the player waits for
    /// first, nearest the playhead, dropping the rest.
    private func drain() {
        while true {
            lock.lock()
            guard building == nil else { lock.unlock(); return }
            let stale = jobs.filter(isStale)
            jobs.removeAll(where: isStale)
            let next = jobs.min { a, b in
                let ra = a.purpose == .prefetch ? 1 : 0, rb = b.purpose == .prefetch ? 1 : 0
                return ra != rb ? ra < rb : abs(a.index - playhead) < abs(b.index - playhead)
            }
            if let next { jobs.removeAll { $0 === next } }
            building = next
            lock.unlock()
            for job in stale { job.waiters.forEach { $0.resume(returning: nil) } }
            guard let job = next else { return }

            var data = cached(job.index)
            if data == nil, let segmenter {
                do {
                    data = try segmenter.mediaSegment(job.index) { [unowned self] in
                        self.lock.lock(); defer { self.lock.unlock() }
                        return self.isStale(job)
                    }
                } catch RemuxError.abandoned {
                    data = nil
                } catch {
                    remuxLog("segment \(job.index) failed: \(error.localizedDescription)")
                }
                if let data {
                    markBuilt(job.index)
                    store(job.index, data)
                }
            }
            lock.lock()
            building = nil
            let waiters = job.waiters
            lock.unlock()
            waiters.forEach { $0.resume(returning: data) }
        }
    }

    private func cached(_ n: Int) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return cache[n]
    }

    /// Keeps the last couple of segments (the player re-asks after a stall or a short seek
    /// back). Only two: a 4K segment is tens of MB, and the player buffers the rest itself.
    private func store(_ n: Int, _ data: Data) {
        lock.lock(); defer { lock.unlock() }
        cache[n] = data
        cacheOrder.removeAll { $0 == n }
        cacheOrder.append(n)
        while cacheOrder.count > 2 { cache.removeValue(forKey: cacheOrder.removeFirst()) }
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
