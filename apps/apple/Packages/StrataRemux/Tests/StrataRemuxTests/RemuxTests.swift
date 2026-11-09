import AVFoundation
import FFmpeg
import XCTest
@testable import StrataRemux

final class RemuxTests: XCTestCase {
    private func fixture(_ name: String) -> URL {
        Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: nil)!
    }

    private func segmenter(_ name: String, plan: RemuxPlan = RemuxPlan()) throws -> Segmenter {
        let demuxer = try Demuxer(source: FileByteSource(url: fixture(name)), videoIndex: nil)
        return try Segmenter(demuxer: demuxer, plan: plan)
    }

    /// The whole repackaged file (init + every segment), as one fragmented MP4.
    private func remuxed(_ segmenter: Segmenter) throws -> URL {
        var data = try segmenter.initSegment()
        for i in 0..<segmenter.segmentCount { data.append(try segmenter.mediaSegment(i)) }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("remux-\(UUID().uuidString).mp4")
        try data.write(to: url)
        return url
    }

    func testSegmentsStartAtKeyframesAndCoverTheFile() throws {
        let s = try segmenter("hevc_eac3_srt.mkv")
        XCTAssertGreaterThan(s.demuxer.keyframes.count, 5, "the MKV index should list the keyframes")
        XCTAssertEqual(s.boundaries.first, 0)
        XCTAssertEqual(s.boundaries.last!, 20, accuracy: 0.1)
        for i in 0..<(s.segmentCount - 1) {
            XCTAssertGreaterThanOrEqual(s.duration(of: i), Segmenter.targetSeconds - 0.01)
        }
    }

    func testCopiedStreamsKeepEveryFrameAndAreContinuous() throws {
        let s = try segmenter("hevc_eac3_srt.mkv")
        let out = try remuxed(s)
        if let keep = ProcessInfo.processInfo.environment["REMUX_KEEP"] { try? FileManager.default.copyItem(at: out, to: URL(fileURLWithPath: keep)) }
        defer { try? FileManager.default.removeItem(at: out) }
        let check = try Demuxer(source: FileByteSource(url: out), videoIndex: nil)
        let packets = try readAll(check)
        // In sync: video and audio start together, and both last the whole file.
        XCTAssertEqual(packets.videoStart, packets.audioStart, accuracy: 0.03)
        XCTAssertEqual(packets.audioSeconds - packets.audioStart, 20, accuracy: 0.05)
        XCTAssertEqual(packets.video, 480, "24 fps × 20 s, none lost or doubled at the cuts")
        XCTAssertEqual(packets.audioGaps, 0, "audio runs on from one segment into the next")
        XCTAssertEqual(codec(check, AVMEDIA_TYPE_AUDIO), AV_CODEC_ID_EAC3)
        XCTAssertEqual(check.stream(check.videoIndex).pointee.codecpar.pointee.codec_tag, fourCC("hvc1"))
    }

    func testDTSAndTrueHDBecomeLosslessALACWithoutGaps() throws {
        for name in ["h264_dts.mkv", "h264_truehd.mkv"] {
            let s = try segmenter(name, plan: RemuxPlan(audio: .lossless))
            let out = try remuxed(s)
            defer { try? FileManager.default.removeItem(at: out) }
            let check = try Demuxer(source: FileByteSource(url: out), videoIndex: nil)
            XCTAssertEqual(codec(check, AVMEDIA_TYPE_AUDIO), AV_CODEC_ID_ALAC, name)
            let packets = try readAll(check)
            XCTAssertEqual(packets.audioGaps, 0, "\(name): no gap or overlap where segments meet")
            XCTAssertEqual(packets.audioSeconds - packets.audioStart, s.boundaries.last!, accuracy: 0.1, name)
            XCTAssertEqual(packets.videoStart, packets.audioStart, accuracy: 0.03, "\(name) in sync")
        }
    }

    func testTextSubtitlesAreReadFromTheStream() throws {
        let s = try segmenter("hevc_eac3_srt.mkv")
        var cues: [SubtitleCue] = []
        s.onCues = { cues += $0 }
        _ = try s.initSegment()
        for i in 1..<s.segmentCount { _ = try s.mediaSegment(i) }
        XCTAssertEqual(cues.map(\.text), ["First line", "Second line", "Third line"])
        XCTAssertEqual(cues[1].start, 8.5, accuracy: 0.01)
        XCTAssertEqual(cues[1].end, 10, accuracy: 0.01)
    }

    /// The real test: Apple's player accepts the loopback HLS stream and plays it.
    func testAVPlayerPlaysTheLoopbackStream() async throws {
        for (name, plan) in [("hevc_eac3_srt.mkv", RemuxPlan()), ("h264_dts.mkv", RemuxPlan(audio: .lossless))] {
            let session = RemuxSession(source: .file(fixture(name)), plan: plan)
            let url = try await session.start()
            defer { session.stop() }
            let playlist = try String(contentsOf: url, encoding: .utf8)
            XCTAssertTrue(playlist.contains("#EXT-X-ENDLIST"), name)

            let item = AVPlayerItem(url: url)
            let player = AVPlayer(playerItem: item)
            player.isMuted = true
            player.play()
            let deadline = Date().addingTimeInterval(20)
            while item.status == .unknown || item.currentTime().seconds < 1, Date() < deadline {
                if item.status == .failed { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            XCTAssertEqual(item.status, .readyToPlay, "\(name): \(item.error.map { String(describing: $0) } ?? "")")
            XCTAssertGreaterThan(item.currentTime().seconds, 0.5, "\(name) should be playing")
            XCTAssertEqual(item.duration.seconds, 20, accuracy: 0.5, name)
            XCTAssertTrue(item.tracks.contains { $0.assetTrack?.mediaType == .audio }, "\(name) has an audio track")
            // Seek near the end: the player asks for a segment far ahead and keeps going.
            await player.seek(to: CMTime(seconds: 15, preferredTimescale: 600))
            try await Task.sleep(for: .milliseconds(800))
            XCTAssertGreaterThan(item.currentTime().seconds, 14.9, name)
            player.pause()
        }
    }

    /// A resume starts the stream at its segment: the player begins there without fetching
    /// the start of the file, and the header built from that segment still plays the rest.
    func testStartingMidFileBeginsThere() async throws {
        let session = RemuxSession(source: .file(fixture("hevc_eac3_srt.mkv")), plan: RemuxPlan())
        let url = try await session.start(at: 13)
        defer { session.stop() }
        let playlist = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(playlist.contains("#EXT-X-START:TIME-OFFSET=13.000"), playlist)

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.play()
        let deadline = Date().addingTimeInterval(20)
        while item.status == .unknown || item.currentTime().seconds < 13.5, Date() < deadline {
            if item.status == .failed { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertEqual(item.status, .readyToPlay, item.error.map { String(describing: $0) } ?? "")
        XCTAssertGreaterThan(item.currentTime().seconds, 12.9, "begins at the resume point")
        // Back to the start: segments before the first one built play too.
        await player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
        try await Task.sleep(for: .milliseconds(1500))
        XCTAssertGreaterThan(item.currentTime().seconds, 0.3)
        XCTAssertLessThan(item.currentTime().seconds, 5)
        player.pause()
    }

    /// Subtitles go to the player as a WebVTT track it draws itself (so they show in Picture
    /// in Picture and on AirPlay), at the right moment.
    func testSubtitlesAreAWebVTTTrackThePlayerShows() async throws {
        let session = RemuxSession(source: .file(fixture("hevc_eac3_srt.mkv")), plan: RemuxPlan())
        session.subtitleRenditions = [.init(streamIndex: 2, name: "English", language: "en")]
        let url = try await session.start()
        defer { session.stop() }
        let master = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(master.contains("TYPE=SUBTITLES"), master)

        let asset = AVURLAsset(url: url)
        let group = try await XCTUnwrapAsync(await asset.loadMediaSelectionGroup(for: .legible))
        let english = try XCTUnwrap(group.options.first { $0.extendedLanguageTag == "en" }, "\(group.options)")
        let item = AVPlayerItem(asset: asset)
        let collector = LegibleCollector()
        let output = AVPlayerItemLegibleOutput()
        output.setDelegate(collector, queue: .main)
        output.suppressesPlayerRendering = true
        item.add(output)
        item.select(english, in: group)
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        while item.status != .readyToPlay { try await Task.sleep(for: .milliseconds(50)) }
        await player.seek(to: CMTime(seconds: 7.5, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        player.play()
        try await Task.sleep(for: .seconds(3))
        player.pause()
        let second = try XCTUnwrap(collector.lines.first { $0.text.contains("Second line") }, "\(collector.lines)")
        XCTAssertEqual(second.time, 8.5, accuracy: 0.3, "shown when the line starts in the file")
    }

    /// For AirPlay the stream is also served at the Wi-Fi address, only under its secret path.
    func testNetworkAddressServesTheStreamOnlyUnderItsToken() async throws {
        guard WiFiAddress.current() != nil else { throw XCTSkip("no Wi-Fi address") }
        let session = RemuxSession(source: .file(fixture("hevc_eac3_srt.mkv")), plan: RemuxPlan())
        _ = try await session.start()
        defer { session.stop() }
        let network = try await session.networkPlaylistURL()
        XCTAssertNotEqual(network.host, "127.0.0.1")
        XCTAssertEqual(network.pathComponents.count, 3, network.path)
        XCTAssertEqual(network.pathComponents[1].count, 32, "a 128-bit token")
        // Fetched over loopback: the Mac's firewall may hold back LAN connections to a test binary.
        var local = URLComponents(url: network, resolvingAgainstBaseURL: false)!
        local.host = "127.0.0.1"
        let url = local.url!
        let (playlist, response) = try await URLSession.shared.data(from: url)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertTrue(String(decoding: playlist, as: UTF8.self).contains("seg00000.m4s"))
        let segment = url.deletingLastPathComponent().appendingPathComponent("seg00000.m4s")
        let (_, segmentResponse) = try await URLSession.shared.data(from: segment)
        XCTAssertEqual((segmentResponse as? HTTPURLResponse)?.statusCode, 200)
        var guess = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        guess.path = "/index.m3u8"
        let (_, guessed) = try await URLSession.shared.data(from: guess.url!)
        XCTAssertEqual((guessed as? HTTPURLResponse)?.statusCode, 404)
        let again = try await session.networkPlaylistURL()
        XCTAssertEqual(again.path, url.path, "one network server per session")
    }

    /// Over HTTP with byte ranges, as from TorBox, including a link that has expired: the
    /// session asks for a new one and carries on.
    func testRemoteFileWithAnExpiredLink() async throws {
        let file = try Data(contentsOf: fixture("hevc_eac3_srt.mkv"))
        let origin = try LoopbackServer { path in path == "/good.mkv" ? .ok(file, "video/x-matroska") : .notFound }
        let port = try await origin.start()
        defer { origin.stop() }
        let good = URL(string: "http://127.0.0.1:\(port)/good.mkv")!
        let refreshed = Once()
        var didRefresh = false
        let session = RemuxSession(
            source: .remote(URL(string: "http://127.0.0.1:\(port)/expired.mkv")!, refresh: { refreshed.run { didRefresh = true }; return good }),
            plan: RemuxPlan()
        )
        let url = try await session.start()
        defer { session.stop() }
        XCTAssertTrue(didRefresh)
        let (segment, response) = try await URLSession.shared.data(from: url.deletingLastPathComponent().appendingPathComponent("seg00002.m4s"))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(String(decoding: segment[4..<8], as: UTF8.self), "moof")
        XCTAssertGreaterThan(session.stats.bytesFetched, 0)
    }

    // MARK: - Helpers

    private func codec(_ d: Demuxer, _ type: FFmpeg.AVMediaType) -> AVCodecID? {
        (0..<d.streamCount).map { d.stream($0).pointee.codecpar.pointee }.first { $0.codec_type == type }?.codec_id
    }

    private func readAll(_ d: Demuxer) throws -> (video: Int, audioGaps: Int, audioSeconds: Double, videoStart: Double, audioStart: Double) {
        let packet = av_packet_alloc()!
        defer { var p: UnsafeMutablePointer<AVPacket>? = packet; av_packet_free(&p) }
        var video = 0, gaps = 0
        var nextAudio: Int64?
        var audioEnd: Int64 = 0
        var audioTB = AVRational(num: 1, den: 1)
        var videoStart = Double.infinity, audioStart = Double.infinity
        while try d.read(into: packet) {
            defer { av_packet_unref(packet) }
            let st = d.stream(packet.pointee.stream_index)
            let t = Double(packet.pointee.pts) * st.pointee.time_base.seconds
            if st.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_VIDEO { video += 1; videoStart = min(videoStart, t) }
            if st.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO {
                audioTB = st.pointee.time_base
                audioStart = min(audioStart, t)
                if let expected = nextAudio, abs(packet.pointee.pts - expected) > 1 { gaps += 1 }
                nextAudio = packet.pointee.pts + packet.pointee.duration
                audioEnd = nextAudio!
            }
        }
        return (video, gaps, Double(audioEnd) * audioTB.seconds, videoStart, audioStart)
    }
}

/// Lines the player would draw, with when.
final class LegibleCollector: NSObject, AVPlayerItemLegibleOutputPushDelegate, @unchecked Sendable {
    var lines: [(text: String, time: Double)] = []

    func legibleOutput(_ output: AVPlayerItemLegibleOutput, didOutputAttributedStrings strings: [NSAttributedString],
                       nativeSampleBuffers: [Any], forItemTime itemTime: CMTime) {
        for s in strings where !s.string.isEmpty { lines.append((s.string, itemTime.seconds)) }
    }
}

func XCTUnwrapAsync<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) async throws -> T {
    try XCTUnwrap(value, file: file, line: line)
}
