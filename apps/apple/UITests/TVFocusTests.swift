import XCTest

/// Drives the Apple TV app with the Siri Remote: Home → movie → Play → player.
/// Expects the app to be signed in already (e.g. to the demo server).
final class TVFocusTests: XCTestCase {
    let remote = XCUIRemote.shared
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func snapshot(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
        // For local review: TEST_RUNNER_STRATA_SHOTS=<dir> writes each screenshot there too.
        if let dir = ProcessInfo.processInfo.environment["STRATA_SHOTS"] {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    private func press(_ button: XCUIRemote.Button, _ times: Int = 1, pause: TimeInterval = 0.6) {
        for _ in 0..<times {
            remote.press(button)
            Thread.sleep(forTimeInterval: pause)
        }
    }

    /// Detail page: the hero fills the screen with Play focused; down scrolls to the sections below.
    func testDetailHeroAndSections() {
        app.launchArguments = ["-StrataOpenURL", "strata://movie/10378"]
        app.launch()
        XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 15))
        snapshot("detail-01-hero")
        press(.down, pause: 1)
        snapshot("detail-02-down")
        press(.down, pause: 1)
        snapshot("detail-03-down")
        press(.down, pause: 1)
        snapshot("detail-04-down")
    }

    func testBrowseFocusAndPlay() {
        app.launch()
        XCTAssertTrue(app.buttons["Home"].waitForExistence(timeout: 15))
        snapshot("01-home-tabs")

        // Down from the tab bar lands on the first poster.
        press(.down)
        snapshot("02-first-poster-focused")
        let focused = app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true"))
        XCTAssertTrue(focused.exists, "something should have focus after pressing down")
        print("Focused after down: \(focused.label)")

        // Right moves along the rail; left comes back.
        press(.right)
        snapshot("03-rail-right")
        press(.left)

        // Select opens the title page.
        press(.select, pause: 2.5)
        snapshot("04-detail")
        let play = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Play' OR label BEGINSWITH 'Resume'")).firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 10), "detail page should show Play")
        print("Detail focus: \(app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true")).label)")

        // Move to My List and back to Play to check the hero's focus order.
        press(.right)
        snapshot("05-detail-mylist-focused")
        press(.left)
        snapshot("06-detail-play-focused")

        press(.select, pause: 6)
        snapshot("07-player")
        // Controls have auto-hidden by now; play/pause must still reach the player.
        press(.playPause, pause: 1.5)
        snapshot("08-player-paused-chrome")
        XCTAssertTrue(app.buttons["Play"].exists || app.buttons["Pause"].exists, "controls should be showing after play/pause")
        let playerFocus = { self.app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true")) }
        print("Player focus after pause: \(playerFocus().label) \(playerFocus().frame) buttons=\(self.app.buttons.allElementsBoundByIndex.map { $0.label })")
        press(.right, pause: 1)
        print("Player focus after right: \(playerFocus().label) [\(playerFocus().elementType.rawValue)]")
        press(.up, pause: 1)
        print("Player focus after up: \(playerFocus().label) [\(playerFocus().elementType.rawValue)]")
        snapshot("09-player-scrub-focus")
        press(.menu, pause: 2)
        press(.menu, pause: 2)
        snapshot("10-back-from-player")
    }
}
