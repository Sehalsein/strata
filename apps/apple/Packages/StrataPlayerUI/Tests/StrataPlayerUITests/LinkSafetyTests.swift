import Foundation
import XCTest
@testable import StrataPlayerUI

/// TorBox links carry the account's key: what the engine says about one is cut to its host
/// before it reaches a report, the log or the screen. And the engine only opens web links
/// (or, for a download, a file on the device).
final class LinkSafetyTests: XCTestCase {
    func testLinksInMessagesAreCutToTheirHost() {
        XCTAssertEqual(
            PlayerEngine.redact("Couldn't open https://nexus-404.ecan.tb-cdn.io/dld/da20?token=fdada70e-1aca-432c refused"),
            "Couldn't open https://nexus-404.ecan.tb-cdn.io/… refused")
        XCTAssertEqual(PlayerEngine.redact("HTTP 403 for http://192.168.2.163:8490/api/stream/abc?key=s&x=1"),
                       "HTTP 403 for http://192.168.2.163/…")
        XCTAssertEqual(PlayerEngine.redact("token=abc123 and password=hunter2"), "token=… and password=…")
        XCTAssertEqual(PlayerEngine.redact("no links here"), "no links here")
    }

    func testOnlyWebLinksOpen() {
        XCTAssertTrue(PlayerEngine.isOpenable(URL(string: "https://nexus-1.tb-cdn.io/dld/x")!, offline: false))
        XCTAssertTrue(PlayerEngine.isOpenable(URL(string: "http://192.168.2.163:8490/api/stream/1/master.m3u8")!, offline: false))
        XCTAssertTrue(PlayerEngine.isOpenable(URL(fileURLWithPath: "/var/mobile/Downloads/a.mkv"), offline: true))
        XCTAssertFalse(PlayerEngine.isOpenable(URL(string: "smb://nas/share/a.mkv")!, offline: false))
        XCTAssertFalse(PlayerEngine.isOpenable(URL(string: "ftp://host/a.mkv")!, offline: false))
        XCTAssertFalse(PlayerEngine.isOpenable(URL(string: "https:///no-host")!, offline: false))
    }
}
