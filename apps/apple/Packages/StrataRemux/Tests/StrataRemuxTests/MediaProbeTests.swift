import Foundation
import XCTest
@testable import StrataRemux

/// The app reads a file's media info for the server (which can't run ffprobe). Expected
/// values are what ffprobe and the server's `summarize` (probe.ts) report for each fixture.
final class MediaProbeTests: XCTestCase {
    private func fixture(_ name: String) -> URL {
        Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: nil)!
    }

    func testReadsStreamsAsFFprobeDoes() async throws {
        let info = try await MediaProbe.probe(url: fixture("hevc_eac3_srt.mkv"))
        XCTAssertEqual(info.container, "mkv")
        XCTAssertEqual(info.durationMs, 20_000)
        XCTAssertEqual(Double(try XCTUnwrap(info.bitrate)), 348_848, accuracy: 100, "file size × 8 / duration, as ffprobe")
        XCTAssertEqual(info.video, MediaInfo.Video(index: 0, codec: "hevc", profile: "Main", width: 320, height: 180, fps: 24, bitDepth: 8, hdr: nil))
        XCTAssertEqual(info.audio, [MediaInfo.Audio(index: 1, codec: "eac3", channels: 6, language: nil, title: nil, isDefault: false)])
        XCTAssertEqual(info.subtitles, [MediaInfo.Subtitle(index: 2, codec: "subrip", language: nil, title: nil, isDefault: false, isForced: false, isText: true)])
        XCTAssertEqual(info.chapters, [])
    }

    /// The real failure: an HDR10 HEVC MKV with no colour tags in the container (only in
    /// the SPS) read as SDR, because FFmpeg's HEVC parser doesn't read the colour.
    func testHDR10SignalledOnlyInTheHEVCBitstream() async throws {
        let info = try await MediaProbe.probe(url: fixture("hdr10_hevc_untagged.mkv"))
        let video = try XCTUnwrap(info.video)
        XCTAssertEqual(video.hdr, "hdr10")
        XCTAssertEqual(video.bitDepth, 10)
        XCTAssertEqual(video.profile, "Main 10")
        XCTAssertEqual(video.width, 128)
        XCTAssertEqual(video.fps, 24)
        XCTAssertEqual(info.audio, [MediaInfo.Audio(index: 1, codec: "aac", channels: 2, language: "eng", title: "Stereo", isDefault: true)])
        XCTAssertEqual(info.chapters, [MediaInfo.Chapter(startMs: 0, title: "Opening"), MediaInfo.Chapter(startMs: 500, title: "Credits")])
        XCTAssertEqual(Double(info.durationMs), 1044, accuracy: 2)
    }

    func testHLGSignalledOnlyInTheH264Bitstream() async throws {
        let info = try await MediaProbe.probe(url: fixture("hlg_h264_untagged.mkv"))
        let video = try XCTUnwrap(info.video)
        XCTAssertEqual(video.codec, "h264")
        XCTAssertEqual(video.profile, "High")
        XCTAssertEqual(video.hdr, "hlg")
        XCTAssertEqual(video.bitDepth, 8)
    }

    func testHDR10SignalledOnlyInTheAV1Bitstream() async throws {
        let info = try await MediaProbe.probe(url: fixture("hdr10_av1_untagged.mkv"))
        let video = try XCTUnwrap(info.video)
        XCTAssertEqual(video.codec, "av1")
        XCTAssertEqual(video.hdr, "hdr10")
        XCTAssertEqual(video.bitDepth, 10)
    }

    func testSDRFilesStaySDR() async throws {
        for name in ["h264_dts.mkv", "h264_truehd.mkv"] {
            let info = try await MediaProbe.probe(url: fixture(name))
            XCTAssertEqual(info.video?.codec, "h264", name)
            XCTAssertNil(info.video?.hdr, name)
            XCTAssertEqual(info.video?.bitDepth, 8, name)
        }
        let audio = try await MediaProbe.probe(url: fixture("h264_truehd.mkv")).audio
        XCTAssertEqual(audio.map(\.codec), ["truehd"])
    }

    /// Over HTTP with byte ranges, as from TorBox: a link that has expired is replaced, and
    /// only the header is fetched.
    func testRemoteFileWithAnExpiredLink() async throws {
        let file = try Data(contentsOf: fixture("hdr10_hevc_untagged.mkv"))
        let origin = try LoopbackServer { path in path == "/good.mkv" ? (file, "video/x-matroska") : nil }
        let port = try await origin.start()
        defer { origin.stop() }
        let good = URL(string: "http://127.0.0.1:\(port)/good.mkv")!
        let refreshed = Once()
        nonisolated(unsafe) var didRefresh = false
        let info = try await MediaProbe.probe(url: URL(string: "http://127.0.0.1:\(port)/expired.mkv")!,
                                              refresh: { refreshed.run { didRefresh = true }; return good })
        XCTAssertTrue(didRefresh)
        XCTAssertEqual(info.container, "mkv")
        XCTAssertEqual(info.video?.hdr, "hdr10")
    }

    func testAStalledServerFailsInsteadOfHanging() async throws {
        let origin = try LoopbackServer { _ in
            try? await Task.sleep(for: .seconds(10))
            return nil
        }
        let port = try await origin.start()
        defer { origin.stop() }
        let started = Date()
        do {
            _ = try await MediaProbe.probe(url: URL(string: "http://127.0.0.1:\(port)/slow.mkv")!, timeout: 0.5)
            XCTFail("expected a timeout")
        } catch let error as RemuxError {
            XCTAssertEqual(error, .network("The file server took too long to answer."))
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }

    func testUnreadableFileFails() async throws {
        let junk = FileManager.default.temporaryDirectory.appendingPathComponent("junk-\(UUID().uuidString).mkv")
        try Data(repeating: 0x42, count: 4096).write(to: junk)
        defer { try? FileManager.default.removeItem(at: junk) }
        do {
            _ = try await MediaProbe.probe(url: junk)
            XCTFail("expected an error")
        } catch {
            XCTAssertFalse(error.localizedDescription.isEmpty)
        }
    }

    /// The JSON matches the server's MediaInfo: `hdr` is always there (null for SDR), other
    /// unknowns are left out.
    func testJSONShape() throws {
        let info = MediaInfo(container: "mkv", durationMs: 1000, bitrate: nil,
                             video: .init(index: 0, codec: "hevc", width: 3840, height: 2160, hdr: nil),
                             audio: [.init(index: 1, codec: "eac3", channels: 6, language: nil, title: nil, isDefault: true)],
                             subtitles: [], chapters: [.init(startMs: 0, title: nil)])
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(info)) as? [String: Any])
        XCTAssertNil(json["bitrate"])
        let video = try XCTUnwrap(json["video"] as? [String: Any])
        XCTAssertTrue(video["hdr"] is NSNull, "\(video)")
        XCTAssertNil(video["profile"])
        XCTAssertNil(video["dvProfile"])
        let audio = try XCTUnwrap((json["audio"] as? [[String: Any]])?.first)
        XCTAssertNil(audio["language"])
        XCTAssertEqual(audio["isDefault"] as? Bool, true)
        XCTAssertEqual(try JSONDecoder().decode(MediaInfo.self, from: JSONEncoder().encode(info)), info)
    }

    func testContainerNames() {
        XCTAssertEqual(MediaProbe.container(formatName: "matroska,webm", path: "/a/Movie.mkv"), "mkv")
        XCTAssertEqual(MediaProbe.container(formatName: "matroska,webm", path: "/a/clip.WEBM"), "webm")
        XCTAssertEqual(MediaProbe.container(formatName: "mov,mp4,m4a,3gp,3g2,mj2", path: "/a/Movie.mp4"), "mp4")
        XCTAssertEqual(MediaProbe.container(formatName: "mov,mp4,m4a,3gp,3g2,mj2", path: "/a/Movie.mov"), "mov")
        XCTAssertEqual(MediaProbe.container(formatName: "avi", path: "/a/Movie.avi"), "avi")
    }
}
