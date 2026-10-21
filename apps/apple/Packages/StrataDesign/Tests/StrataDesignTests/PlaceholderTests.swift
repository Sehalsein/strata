import XCTest
@testable import StrataDesign

final class PlaceholderTests: XCTestCase {
    /// A title keeps the same placeholder colors across launches (FNV-1a, not hashValue).
    func testVariantIsStablePerSeed() {
        XCTAssertEqual(StrataPlaceholder.index(for: "movie-10378", count: 4), StrataPlaceholder.index(for: "movie-10378", count: 4))
        // Pinned value: changing the hash would reshuffle every placeholder.
        XCTAssertEqual(StrataPlaceholder.index(for: "a", count: 1_000_000), Int((UInt32(2_166_136_261) ^ 0x61) &* 16_777_619 % 1_000_000))
    }

    func testVariantStaysInRange() {
        for seed in ["", "x", "show-9001", "a much longer seed with spaces"] {
            XCTAssertTrue((0..<5).contains(StrataPlaceholder.index(for: seed, count: 5)))
        }
    }
}
