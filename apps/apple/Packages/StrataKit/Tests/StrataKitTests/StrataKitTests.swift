import XCTest
@testable import StrataKit

final class StrataKitTests: XCTestCase {
    func testAuthHeaderShape() {
        let url = URL(string: "http://localhost:8096")!
        let client = JellyfinClient(unauthenticated: url)
        let header = client.authorizationHeader(includeToken: false)
        XCTAssertTrue(header.hasPrefix("MediaBrowser "))
        XCTAssertTrue(header.contains("Client=\"Strata\""))
        XCTAssertTrue(header.contains("Version=\"0.1.0\""))
        XCTAssertTrue(header.contains("DeviceId="))
        XCTAssertFalse(header.contains("Token="))
    }

    func testImageURLBuilderIncludesToken() {
        let builder = ImageURLBuilder(serverURL: URL(string: "http://h:8096")!, token: "abc")
        let url = builder.primary(itemId: "xyz")
        XCTAssertNotNil(url)
        XCTAssertTrue(url!.absoluteString.contains("api_key=abc"))
        XCTAssertTrue(url!.absoluteString.contains("/Items/xyz/Images/Primary"))
        XCTAssertTrue(url!.absoluteString.contains("maxWidth=720"))
    }

    func testBaseItemDecode() throws {
        let json = """
        {
          "Id": "1234",
          "Name": "Test Movie",
          "Type": "Movie",
          "RunTimeTicks": 36000000000,
          "UserData": { "PlaybackPositionTicks": 12000000000, "Played": false }
        }
        """.data(using: .utf8)!
        let item = try JSONDecoder().decode(BaseItem.self, from: json)
        XCTAssertEqual(item.id, "1234")
        XCTAssertEqual(item.displayTitle, "Test Movie")
        XCTAssertEqual(item.type, .movie)
        XCTAssertEqual(item.runtimeSeconds, 3600)
        XCTAssertEqual(item.resumePositionSeconds, 1200)
    }
}
