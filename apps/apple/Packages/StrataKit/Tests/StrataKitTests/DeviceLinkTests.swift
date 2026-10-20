import XCTest
@testable import StrataKit

final class DeviceLinkTests: XCTestCase {
    func testCodesNormalizeAndDisplayInTwoGroups() {
        XCTAssertEqual(DeviceLink.normalize(" k7qf-2mxd "), "K7QF2MXD")
        XCTAssertEqual(DeviceLink.normalize("K7QF 2MXD"), "K7QF2MXD")
        let link = DeviceLink(code: "K7QF2MXD", pollToken: "secret", expiresAt: 0, pollIntervalMs: 2000)
        XCTAssertEqual(link.displayCode, "K7QF-2MXD")
    }

    func testApprovalURLCarriesCodeAndServerButNotThePollToken() throws {
        let link = DeviceLink(code: "K7QF2MXD", pollToken: "secret", expiresAt: 0, pollIntervalMs: 2000)
        let url = try XCTUnwrap(link.approvalURL(serverID: "srv-1"))
        XCTAssertEqual(url.scheme, "strata")
        XCTAssertEqual(url.host(), "link")
        XCTAssertTrue(url.absoluteString.contains("code=K7QF2MXD"))
        XCTAssertTrue(url.absoluteString.contains("server=srv-1"))
        XCTAssertFalse(url.absoluteString.contains("secret"))
    }
}
