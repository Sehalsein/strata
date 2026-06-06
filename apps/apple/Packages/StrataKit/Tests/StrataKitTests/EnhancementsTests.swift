import XCTest
@testable import StrataKit

final class MediaSegmentTests: XCTestCase {
    func testDecodeEnvelopeAndTickConversion() throws {
        // 90s intro (900_000_000 ticks) and a credits segment.
        let json = """
        {
          "Items": [
            { "Id": "a", "ItemId": "ep1", "Type": "Intro", "StartTicks": 0, "EndTicks": 900000000 },
            { "Id": "b", "ItemId": "ep1", "Type": "Outro", "StartTicks": 30000000000, "EndTicks": 33000000000 }
          ],
          "TotalRecordCount": 2
        }
        """.data(using: .utf8)!
        let env = try JSONDecoder().decode(MediaSegmentEnvelope.self, from: json)
        let segments = try XCTUnwrap(env.items)
        XCTAssertEqual(segments.count, 2)

        let intro = segments[0]
        XCTAssertEqual(intro.type, .intro)
        XCTAssertEqual(intro.start, 0, accuracy: 0.001)
        XCTAssertEqual(intro.end, 90, accuracy: 0.001)
        XCTAssertTrue(intro.contains(45))
        XCTAssertFalse(intro.contains(90)) // end is exclusive
        XCTAssertFalse(intro.contains(120))

        XCTAssertEqual(segments[1].type, .outro)
        XCTAssertEqual(segments[1].start, 3000, accuracy: 0.001)
    }

    func testUnknownSegmentTypeDecodesGracefully() throws {
        let json = """
        { "Items": [ { "Type": "Sponsorship", "StartTicks": 0, "EndTicks": 10 } ] }
        """.data(using: .utf8)!
        let env = try JSONDecoder().decode(MediaSegmentEnvelope.self, from: json)
        XCTAssertEqual(env.items?.first?.type, .unknown)
    }
}

final class ResponseCacheTests: XCTestCase {
    func testStoreHitWithinTTLAndMissAfter() async {
        let cache = ResponseCache()
        let key = "https://h/Items"
        let t0 = Date(timeIntervalSince1970: 1_000)
        let payload = Data("hello".utf8)

        await cache.store(payload, for: key, now: t0)
        // Within the 60s TTL → hit.
        let hit = await cache.data(for: key, now: t0.addingTimeInterval(30))
        XCTAssertEqual(hit, payload)
        // Past the TTL → miss.
        let miss = await cache.data(for: key, now: t0.addingTimeInterval(61))
        XCTAssertNil(miss)
    }

    func testClearEvictsEverything() async {
        let cache = ResponseCache()
        let t0 = Date(timeIntervalSince1970: 1_000)
        await cache.store(Data("x".utf8), for: "k", now: t0)
        await cache.clear()
        let result = await cache.data(for: "k", now: t0)
        XCTAssertNil(result)
    }
}

final class ItemSortTests: XCTestCase {
    func testRawValuesMatchJellyfinFields() {
        XCTAssertEqual(JellyfinClient.ItemSort.Field.dateAdded.rawValue, "DateCreated")
        XCTAssertEqual(JellyfinClient.ItemSort.Field.title.rawValue, "SortName")
        XCTAssertEqual(JellyfinClient.ItemSort.recentlyAdded.order, .descending)
        XCTAssertEqual(JellyfinClient.ItemSort.titleAsc.field, .title)
    }

    func testEveryFieldHasALabel() {
        for field in JellyfinClient.ItemSort.Field.allCases {
            XCTAssertFalse(field.label.isEmpty)
        }
    }
}

final class ImageSizingTests: XCTestCase {
    func testPrimaryHonoursExplicitMaxWidth() throws {
        let builder = ImageURLBuilder(serverURL: URL(string: "http://h:8096")!, token: "t")
        let url = try XCTUnwrap(builder.primary(itemId: "z", maxWidth: 360))
        XCTAssertTrue(url.absoluteString.contains("maxWidth=360"))
    }
}

final class BaseItemRobustnessTests: XCTestCase {
    func testDisplayTitleFallsBackThroughOriginalTitleThenUntitled() throws {
        let onlyOriginal = """
        { "Id": "1", "OriginalTitle": "Le Film", "Type": "Movie" }
        """.data(using: .utf8)!
        let a = try JSONDecoder().decode(BaseItem.self, from: onlyOriginal)
        XCTAssertEqual(a.displayTitle, "Le Film")

        let neither = """
        { "Id": "2", "Type": "Movie" }
        """.data(using: .utf8)!
        let b = try JSONDecoder().decode(BaseItem.self, from: neither)
        XCTAssertEqual(b.displayTitle, "Untitled")
    }

    func testUnknownItemKindDecodesToUnknown() throws {
        let json = """
        { "Id": "3", "Type": "MusicVideo" }
        """.data(using: .utf8)!
        let item = try JSONDecoder().decode(BaseItem.self, from: json)
        XCTAssertEqual(item.type, .unknown)
    }
}
