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
        if name == "index.m3u8" { return (Data(playlist().utf8), "application/vnd.apple.mpegurl") }
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

    private func deliver(_ cues: [SubtitleCue]) {
        lock.lock()
        let fresh = cues.filter { seenCues.insert($0).inserted }
        lock.unlock()
        if !fresh.isEmpty { onCues?(fresh) }
    }

    private func onWorkQueue<T>(_ body: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            work.async { continuation.resume(with: Result { try body() }) }
        }
    }
}
