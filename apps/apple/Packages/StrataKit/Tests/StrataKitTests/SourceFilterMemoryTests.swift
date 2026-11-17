import XCTest
@testable import StrataKit

final class SourceFilterMemoryTests: XCTestCase {
    private let server = URL(string: "https://strata.example")!

    func testKeepsFiltersPerServerAcrossLaunches() {
        let defaults = UserDefaults(suiteName: "SourceFilterMemoryTests-\(UUID().uuidString)")!
        let memory = SourceFilterMemory(defaults: defaults)
        XCTAssertTrue(memory.filters(server: server).isEmpty)
        memory.set(.init(picked: ["quality": "2160p"], quality: nil), server: server)
        XCTAssertEqual(SourceFilterMemory(defaults: defaults).filters(server: server).picked, ["quality": "2160p"], "kept across launches")
        XCTAssertTrue(memory.filters(server: URL(string: "https://other.example")!).isEmpty)
        memory.set(.init(), server: server)
        XCTAssertTrue(memory.filters(server: server).isEmpty, "cleared")
    }

    func testOnlyOptionsTheListOffersApply() {
        let list = SourceList(items: [], filters: [
            SourceFilterGroup(id: "quality", title: "Quality", options: [.init(id: "1080p", label: "1080p", count: 2)]),
        ])
        XCTAssertEqual(list.applicable(["quality": "1080p", "language": "fr"]), ["quality": "1080p"])
        XCTAssertEqual(list.applicable(["quality": "2160p"]), [:])
    }
}
