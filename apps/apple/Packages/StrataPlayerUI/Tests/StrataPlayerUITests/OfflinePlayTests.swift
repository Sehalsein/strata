import AVFoundation
import XCTest
import StrataKit
@testable import StrataPlayerUI

/// A downloaded MKV plays from disk through the device engine, with no server: from where
/// it was left, with its embedded subtitles, and progress kept for later.
@MainActor
final class OfflinePlayTests: XCTestCase {
    private var fixture: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../StrataRemux/Tests/StrataRemuxTests/Fixtures/hevc_eac3_srt.mkv").standardized
    }

    func testPlaysADownloadedFileWithoutAServer() async throws {
        let json: [String: Any] = [
            "fileId": 1, "url": "https://cdn.torbox.test/1", "mode": "device",
            "remux": ["audio": "copy", "audioStreamIndex": 1, "videoStreamIndex": 0, "stripDolbyVision": false],
            "durationMs": 20_000,
            "candidate": ["id": "file:1", "fileId": 1, "provider": "torbox", "name": "Clip.mkv", "size": 1_000_000, "probed": true],
            "audioTracks": [["index": 1, "codec": "eac3", "channels": 6, "selected": true]],
            "subtitleTracks": [["id": "s2", "codec": "subrip", "language": "eng", "forced": false, "isDefault": false, "external": false,
                                "url": NSNull(), "embedded": true, "streamIndex": 2]],
            "chapters": [],
        ]
        let response = try JSONDecoder().decode(DownloadResponse.self, from: JSONSerialization.data(withJSONObject: json))
        var item = DownloadItem(signInID: "me", target: .movie(.tmdb(.movie, 1)), title: "Clip", subtitle: nil, artworkURL: nil, response: response)
        item.positionMs = 6_000

        let engine = PlayerEngine() // no client: nothing goes to a server
        engine.toggleMute()
        var kept: [Int] = []
        engine.onProgress = { _, ms, _ in kept.append(ms) }
        let undelivered = Counter()
        engine.onUndeliveredProgress = { _, _, _ in undelivered.add() }

        await engine.load(offline: item.playResponse(fileURL: fixture, resumeMs: item.positionMs), target: item.target, meta: PlaybackMeta(title: "Clip"))
        XCTAssertEqual(engine.status, .playing, "\(engine.status)")
        XCTAssertEqual(engine.session?.isOffline, true)
        XCTAssertEqual(engine.position, 6, accuracy: 0.6, "resumes where it was left")
        XCTAssertEqual(engine.subtitleTracks.first?.isEmbedded, true)

        try await Task.sleep(for: .seconds(2))
        XCTAssertGreaterThan(engine.position, 6.5, "plays on")
        await engine.seek(to: 15)
        XCTAssertEqual(engine.position, 15, accuracy: 0.6)
        engine.pause()
        XCTAssertFalse(kept.isEmpty, "positions are kept for the download")
        XCTAssertGreaterThan(undelivered.value, 0, "and queued for the server")
        await engine.unload()
    }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var value: Int { lock.withLock { count } }
    func add() { lock.withLock { count += 1 } }
}
