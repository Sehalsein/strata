import XCTest
import StrataKit
@testable import StrataPlayerUI

/// Plays real streams from a running Strata server. Set STRATA_TEST_SERVER and
/// STRATA_TEST_TOKEN (a token with a profile selected) to run.
@MainActor
final class EngineLiveTests: XCTestCase {
    func testPlaysAndAdvances() async throws {
        guard let base = ProcessInfo.processInfo.environment["STRATA_TEST_SERVER"].flatMap(URL.init(string:)),
              let token = ProcessInfo.processInfo.environment["STRATA_TEST_TOKEN"] else { throw XCTSkip("no test server") }
        for target in [PlaybackTarget.movie(10378), .episode(show: 9001, season: 1, episode: 1)] {
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
        await engine.load(target: .movie(10378), meta: PlaybackMeta(title: "t"), startMs: 15_000)
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
}
