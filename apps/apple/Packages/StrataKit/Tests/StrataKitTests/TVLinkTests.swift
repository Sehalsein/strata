import Network
import XCTest
@testable import StrataKit

final class TVLinkTests: XCTestCase {
    func testQRCodeHoldsTheKey() {
        let url = TVLink.url(key: "ABC123")
        XCTAssertEqual(url.absoluteString, "strata://tv-link?key=ABC123")
        XCTAssertEqual(TVLink.key(in: url), "ABC123")
        XCTAssertNil(TVLink.key(in: URL(string: "strata://link?user_code=X")!))
        XCTAssertNil(TVLink.key(in: URL(string: "strata://tv-link")!))
        XCTAssertEqual(TVLink.newKey().count, 20)
        XCTAssertNotEqual(TVLink.newKey(), TVLink.newKey())
    }

    /// The TV's own listener, over loopback: macOS keeps a test process off the local
    /// network (Local Network privacy), so the Bonjour search itself isn't exercised here.
    @MainActor
    private func started(_ host: TVLinkHost) async throws -> [NWEndpoint] {
        host.start()
        for _ in 0..<50 where host.port == nil { try await Task.sleep(for: .milliseconds(20)) }
        let port = try XCTUnwrap(host.port.flatMap(NWEndpoint.Port.init(rawValue:)))
        return [.hostPort(host: "127.0.0.1", port: port)]
    }

    /// The phone reaches the TV, hands it the server and gets its code.
    @MainActor
    func testPhoneHandsTheTVItsServer() async throws {
        let host = TVLinkHost()
        var received: [String] = []
        host.onOffer = { addresses in
            received = addresses
            return "WXYZ-2345"
        }
        let tv = try await started(host)
        defer { host.stop() }
        let code = try await TVLinkClient.link(key: host.key, addresses: [URL(string: "http://192.168.1.20:8420")!], timeout: 10, endpoints: tv)
        XCTAssertEqual(code, "WXYZ-2345")
        XCTAssertEqual(received, ["http://192.168.1.20:8420"])
    }

    /// A phone that scanned another TV's code gets nothing from this one.
    @MainActor
    func testAnotherTVsKeyIsRefused() async throws {
        let host = TVLinkHost()
        host.onOffer = { _ in XCTFail("offer taken with the wrong key"); return "" }
        let tv = try await started(host)
        defer { host.stop() }
        do {
            _ = try await TVLinkClient.link(key: "NOT-THE-KEY", addresses: [], timeout: 2, endpoints: tv)
            XCTFail("linked with the wrong key")
        } catch {
            XCTAssertTrue(StrataError.wrap(error).message.contains("Couldn't find your TV"))
        }
    }
}

extension TVLinkTests {
    /// The TV took the key but couldn't sign in: the phone gets the TV's reason.
    @MainActor
    func testTheTVsFailureReachesThePhone() async throws {
        let host = TVLinkHost()
        host.onOffer = { _ in throw StrataError(kind: .network, message: "This TV can't reach Home.") }
        let tv = try await started(host)
        defer { host.stop() }
        do {
            _ = try await TVLinkClient.link(key: host.key, addresses: [], timeout: 5, endpoints: tv)
            XCTFail("linked although the TV failed")
        } catch {
            XCTAssertEqual(StrataError.wrap(error).message, "This TV can't reach Home.")
        }
    }
}
