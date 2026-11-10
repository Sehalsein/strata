import XCTest
@testable import StrataKit

final class SourceMemoryTests: XCTestCase {
    private let server = URL(string: "https://strata.example")!
    private var defaults: UserDefaults!
    private var memory: SourceMemory!

    override func setUp() {
        defaults = UserDefaults(suiteName: "SourceMemoryTests-\(UUID().uuidString)")
        memory = SourceMemory(defaults: defaults)
    }

    private func candidate(_ id: String, _ resolution: Int?, source: String? = nil, hdr: String? = nil) throws -> Candidate {
        var json: [String: Any] = ["id": id, "fileId": 1, "provider": "local", "name": id, "size": 1, "probed": true]
        if let resolution { json["resolution"] = resolution }
        if let source { json["source"] = source }
        if let hdr { json["hdr"] = hdr }
        return try JSONDecoder().decode(Candidate.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testRemembersAPickPerTitleAndServer() throws {
        let movie = PlaybackTarget.movie(.tmdb(.movie, 1))
        XCTAssertNil(memory.pick(for: movie, server: server))
        memory.remember(try candidate("file:7", 1080), for: movie, server: server)
        XCTAssertEqual(memory.pick(for: movie, server: server), "file:7")
        XCTAssertEqual(SourceMemory(defaults: defaults).pick(for: movie, server: server), "file:7", "kept across launches")
        XCTAssertNil(memory.pick(for: .movie(.tmdb(.movie, 2)), server: server))
        XCTAssertNil(memory.pick(for: movie, server: URL(string: "https://other.example")!))
        memory.forget(movie, server: server)
        XCTAssertNil(memory.pick(for: movie, server: server))
    }

    func testOtherEpisodesGetTheCopyMostLikeThePick() throws {
        let show = TitleRef.tmdb(.show, 9)
        let e1 = PlaybackTarget.episode(show: show, season: 1, episode: 1)
        let e2 = PlaybackTarget.episode(show: show, season: 1, episode: 2)
        XCTAssertFalse(memory.hasShowPreference(e2, server: server))
        memory.remember(try candidate("file:1", 1080, source: "web"), for: e1, server: server)
        XCTAssertTrue(memory.hasShowPreference(e2, server: server))
        XCTAssertNil(memory.pick(for: e2, server: server), "only the episode itself has an exact pick")

        let options = [
            try candidate("file:4k", 2160, source: "remux", hdr: "dv"),
            try candidate("file:bd", 1080, source: "bluray"),
            try candidate("file:web", 1080, source: "web"),
        ]
        XCTAssertEqual(memory.match(options, for: e2, server: server)?.id, "file:web")
        XCTAssertEqual(memory.match(Array(options.prefix(2)), for: e2, server: server)?.id, "file:bd", "same resolution beats nothing")
        XCTAssertNil(memory.match([options[0]], for: e2, server: server), "no copy at the picked resolution: the server chooses")
    }
}
