import AVFoundation
import XCTest
import StrataKit
@testable import StrataPlayerUI

/// Plays real streams from a running Strata server. Set STRATA_TEST_SERVER and
/// STRATA_TEST_TOKEN (a token whose session has a household) to run.
@MainActor
final class EngineLiveTests: XCTestCase {
    func testPlaysAndAdvances() async throws {
        guard let base = ProcessInfo.processInfo.environment["STRATA_TEST_SERVER"].flatMap(URL.init(string:)),
              let token = ProcessInfo.processInfo.environment["STRATA_TEST_TOKEN"] else { throw XCTSkip("no test server") }
        for target in [PlaybackTarget.movie(.tmdb(.movie, 10378)), .episode(show: .tmdb(.show, 9001), season: 1, episode: 1)] {
            let engine = PlayerEngine()
            engine.configure(client: StrataClient(baseURL: base, token: token))
            let loaded = Task { await engine.load(target: target, meta: PlaybackMeta(title: "t"), startMs: 0) }
            for i in 0..<20 {
                try await Task.sleep(for: .milliseconds(500))
                print("[\(target.mediaType)] \(i): status=\(engine.status) pos=\(engine.position) dur=\(engine.duration) buffering=\(engine.isBuffering) rate=\(engine.player.rate) tcs=\(engine.player.timeControlStatus.rawValue) item=\(engine.player.currentItem?.status.rawValue ?? -1)")
            }
            _ = loaded
            XCTAssertEqual(engine.status, .playing)
            XCTAssertGreaterThan(engine.position, 3)
            await engine.unload()
        }
    }

    /// HLS starting at an offset reports media time, and seeking before the stream's
    /// start restarts it at the new position.
    func testOffsetAndRestartSeek() async throws {
        guard let base = ProcessInfo.processInfo.environment["STRATA_TEST_SERVER"].flatMap(URL.init(string:)),
              let token = ProcessInfo.processInfo.environment["STRATA_TEST_TOKEN"] else { throw XCTSkip("no test server") }
        let engine = PlayerEngine()
        engine.configure(client: StrataClient(baseURL: base, token: token))
        await engine.load(target: .movie(.tmdb(.movie, 10378)), meta: PlaybackMeta(title: "t"), startMs: 15_000)
        try await Task.sleep(for: .seconds(2))
        print("after offset start: status=\(engine.status) pos=\(engine.position) offset=\(engine.session?.startOffsetMs ?? -1)")
        XCTAssertEqual(engine.session?.mode, .remux)
        XCTAssertGreaterThan(engine.position, 14)
        let firstSession = engine.session?.sessionId
        await engine.seek(to: 4)
        try await Task.sleep(for: .seconds(3))
        print("after restart seek: status=\(engine.status) pos=\(engine.position) offset=\(engine.session?.startOffsetMs ?? -1)")
        XCTAssertNotEqual(engine.session?.sessionId, firstSession)
        XCTAssertEqual(engine.status, .playing)
        XCTAssert((4...9).contains(engine.position), "position \(engine.position)")
        await engine.unload()
    }

    /// Device mode against TorBox: STRATA_TEST_DEVICE=1 with a server that has Lupin S1E1
    /// (4K HEVC HDR, DD+ 5.1, SRT tracks) and One Piece E1 (three Opus tracks, ASS).
    func testDeviceModeStreamsFromTorBox() async throws {
        guard ProcessInfo.processInfo.environment["STRATA_TEST_DEVICE"] != nil,
              let base = ProcessInfo.processInfo.environment["STRATA_TEST_SERVER"].flatMap(URL.init(string:)),
              let token = ProcessInfo.processInfo.environment["STRATA_TEST_TOKEN"] else { throw XCTSkip("no test server") }
        let engine = PlayerEngine()
        engine.configure(client: StrataClient(baseURL: base, token: token))
        engine.toggleMute()

        // Lupin: 4K HEVC, DD+ copied, starts in seconds, seeks far in place.
        var started = Date()
        await engine.load(target: .episode(show: .tmdb(.show, 96677), season: 1, episode: 1), meta: PlaybackMeta(title: "Lupin"), startMs: 0)
        print("DEVICE lupin start \(Date().timeIntervalSince(started))s status=\(engine.status)")
        XCTAssertEqual(engine.session?.mode, .device)
        XCTAssertTrue(engine.session?.url.host()?.contains("tb-cdn") == true, "straight from TorBox")
        try await waitPlaying(engine, past: 3)
        let session = engine.session?.sessionId
        started = Date()
        await engine.seek(to: 1500)
        try await waitPlaying(engine, past: 1503)
        print("DEVICE lupin seek 1500 → playing at \(engine.position) after \(Date().timeIntervalSince(started))s, read \(engine.remuxStats?.bytesFetched ?? 0) bytes")
        XCTAssertEqual(engine.session?.sessionId, session, "a seek stays in the same session")
        let english = try XCTUnwrap(engine.subtitleTracks.first { $0.isEmbedded && LanguageName.normalized($0.language) == "en" && !$0.forced })
        await engine.selectSubtitle(english)
        let item = try XCTUnwrap(engine.player.currentItem)
        let group = try? await item.asset.loadMediaSelectionGroup(for: .legible)
        if let group, !group.options.isEmpty {
            // The player draws it from the stream itself (so it shows in PiP and on AirPlay).
            let selected = item.currentMediaSelection.selectedMediaOption(in: group)
            print("DEVICE lupin subtitle tracks in the stream: \(group.options.count), selected: \(selected?.displayName ?? "none")")
            XCTAssertEqual(selected?.displayName, english.displayTitle)
            XCTAssertTrue(engine.subtitleCues.isEmpty, "not drawn twice")
            let output = AVPlayerItemLegibleOutput()
            let collector = LegibleLines()
            output.setDelegate(collector, queue: .main)
            output.suppressesPlayerRendering = true
            item.add(output)
            try await Task.sleep(for: .seconds(15))
            print("DEVICE lupin lines from the stream: \(collector.lines.prefix(3))")
            XCTAssertFalse(collector.lines.isEmpty, "the player shows lines from the stream")
            await engine.selectSubtitle(nil)
            XCTAssertNil(item.currentMediaSelection.selectedMediaOption(in: group), "off is off")
        } else {
            // HDR the device can't show: no tracks in the stream, the overlay draws the lines.
            print("DEVICE lupin: no subtitle tracks in the stream (HDR eligible: \(AVPlayer.eligibleForHDRPlayback)), overlay")
            try await Task.sleep(for: .seconds(15))
            print("DEVICE lupin overlay: \(engine.subtitleCues.count) lines, now: \(engine.activeCueText ?? "-")")
            XCTAssertFalse(engine.subtitleCues.isEmpty, "lines read from the file")
        }
        XCTAssertEqual(engine.status, .playing)

        // One Piece: Opus → lossless ALAC, switch to another track mid-play.
        await engine.load(target: .episode(show: .tmdb(.show, 37854), season: 1, episode: 1), meta: PlaybackMeta(title: "One Piece"), startMs: 60_000)
        XCTAssertEqual(engine.session?.mode, .device)
        XCTAssertEqual(engine.session?.remux?.audio, "lossless")
        try await waitPlaying(engine, past: 62)
        print("DEVICE onepiece playing at \(engine.position), audio \(engine.activeAudioIndex ?? -1) of \(engine.audioTracks.map(\.index))")
        let other = try XCTUnwrap(engine.audioTracks.first { $0.index != engine.activeAudioIndex })
        let before = engine.position
        await engine.selectAudio(other)
        try await waitPlaying(engine, past: before + 2)
        print("DEVICE onepiece switched to audio \(other.index) at \(engine.position)")
        XCTAssertEqual(engine.activeAudioIndex, other.index)
        XCTAssertEqual(engine.position, before + 2, accuracy: 6, "picks up where it was")
        XCTAssertTrue(engine.player.currentItem?.tracks.contains { $0.assetTrack?.mediaType == .audio } == true)

        // SDR: the stream carries its subtitle tracks, and the player draws the chosen one.
        let subs = engine.subtitleTracks.filter(\.isEmbedded)
        let opItem = try XCTUnwrap(engine.player.currentItem)
        let opGroup = try await XCTUnwrapAsync(await opItem.asset.loadMediaSelectionGroup(for: .legible))
        XCTAssertEqual(opGroup.options.count, subs.count)
        let pick = try XCTUnwrap(subs.first { LanguageName.normalized($0.language) == "en" } ?? subs.first)
        let lines = LegibleLines()
        let output = AVPlayerItemLegibleOutput()
        output.setDelegate(lines, queue: .main)
        output.suppressesPlayerRendering = true
        opItem.add(output)
        await engine.selectSubtitle(pick)
        XCTAssertNotNil(opItem.currentMediaSelection.selectedMediaOption(in: opGroup))
        XCTAssertTrue(engine.subtitleCues.isEmpty, "not drawn twice")
        // A line starts at 6:47.9 ("Hello...").
        await engine.seek(to: 404)
        try await Task.sleep(for: .seconds(8))
        print("DEVICE onepiece \(pick.displayTitle) from the stream: \(lines.lines.prefix(3))")
        XCTAssertFalse(lines.lines.isEmpty, "the player shows lines from the stream")
        await engine.unload()
    }

    private func waitPlaying(_ engine: PlayerEngine, past position: TimeInterval, timeout: TimeInterval = 40) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if case .failed(let message) = engine.status { XCTFail(message); return }
            if engine.status == .playing, engine.position > position, !engine.isBuffering { return }
            try await Task.sleep(for: .milliseconds(200))
        }
        XCTFail("not playing past \(position): status=\(engine.status) pos=\(engine.position)")
    }
}

final class LegibleLines: NSObject, AVPlayerItemLegibleOutputPushDelegate, @unchecked Sendable {
    var lines: [String] = []

    func legibleOutput(_ output: AVPlayerItemLegibleOutput, didOutputAttributedStrings strings: [NSAttributedString],
                       nativeSampleBuffers: [Any], forItemTime itemTime: CMTime) {
        lines += strings.map(\.string).filter { !$0.isEmpty }
    }
}

func XCTUnwrapAsync<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) async throws -> T {
    try XCTUnwrap(value, file: file, line: line)
}
