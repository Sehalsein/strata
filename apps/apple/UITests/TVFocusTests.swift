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

    /// Launches past "Who's watching?" (picking the focused first profile) when it shows.
    private func launchSignedIn(_ arguments: [String] = []) {
        app.launchArguments = arguments
        app.launch()
        if app.staticTexts["Who's watching?"].waitForExistence(timeout: 6) {
            press(.select, pause: 2)
            if !arguments.isEmpty { app.terminate(); app.launch() } // re-run the launch link now a profile is picked
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
        // STRATA_TEST_MOVIE picks a title on a real server; the demo server knows 10378.
        let movie = ProcessInfo.processInfo.environment["STRATA_TEST_MOVIE"] ?? "10378"
        launchSignedIn(["-StrataOpenURL", "strata://movie/\(movie)"])
        XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 15))
        snapshot("detail-01-hero")
        press(.right, pause: 1)
        snapshot("detail-01b-second-button")
        press(.left, pause: 1)
        press(.down, pause: 1)
        snapshot("detail-02-down")
        press(.down, pause: 1)
        snapshot("detail-03-down")
        press(.down, pause: 1)
        snapshot("detail-04-down")
    }

    /// Signed-out TV on the server's home network: picking the server found on the
    /// network goes straight to "Who's watching?" with no password or code.
    func testHomeNetworkJoin() {
        app.launch()
        XCTAssertTrue(app.buttons["Enter Address"].waitForExistence(timeout: 15))
        Thread.sleep(forTimeInterval: 3) // let Bonjour find servers
        snapshot("join-01-connect")
        press(.select, pause: 3) // the first server row has focus
        XCTAssertTrue(app.staticTexts["Who's watching?"].waitForExistence(timeout: 15), "home-network join should skip sign-in")
        snapshot("join-02-profiles")
        press(.select, pause: 4)
        XCTAssertTrue(app.buttons["Home"].waitForExistence(timeout: 15))
        Thread.sleep(forTimeInterval: 3)
        snapshot("join-03-home")
        press(.right, pause: 1)
        snapshot("join-04-more-info-focused")
        // A real detail page: down from the hero's Play into the rails below.
        press(.select, pause: 4)
        snapshot("join-05-detail")
        press(.down, 2, pause: 1)
        snapshot("join-06-detail-rails")
    }

    /// Signed-out TV off the home network (or with home sign-in off): type a server address, get the QR code, then wait for a phone to
    /// approve it (done by hand or by a script while this runs). Needs STRATA_TEST_SERVER.
    func testCodeSignIn() throws {
        let server = try XCTUnwrap(ProcessInfo.processInfo.environment["STRATA_TEST_SERVER"], "set TEST_RUNNER_STRATA_TEST_SERVER")
        app.launch()
        let enterAddress = app.buttons["Enter Address"]
        XCTAssertTrue(enterAddress.waitForExistence(timeout: 15))
        snapshot("signin-01-connect")
        // Down past any discovered servers to "Enter Address", which opens the address screen.
        var presses = 0
        while !enterAddress.hasFocus && presses < 8 { press(.down); presses += 1 }
        press(.select, pause: 1.5)
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        while !field.hasFocus { press(.down) }
        press(.select)
        app.typeText(server)
        snapshot("signin-02-typed")
        press(.menu, pause: 1) // close the keyboard, submitting the address
        if !app.buttons["Use Password Instead"].waitForExistence(timeout: 10) {
            while !app.buttons["Continue"].hasFocus { press(.down) }
            press(.select)
        }
        XCTAssertTrue(app.buttons["Use Password Instead"].waitForExistence(timeout: 15))
        Thread.sleep(forTimeInterval: 2)
        snapshot("signin-03-qr")
        let code = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Code '")).firstMatch
        if code.exists { print("SIGNIN_CODE \(code.label.replacingOccurrences(of: "Code ", with: "").replacingOccurrences(of: " ", with: ""))") }
        // Approved from the phone: the TV moves on to the profile picker.
        XCTAssertTrue(app.staticTexts["Who's watching?"].waitForExistence(timeout: 180), "the TV should sign in once the code is approved")
        snapshot("signin-04-profiles")
    }

    /// The profile tab at the end of the tab bar opens Settings with Switch Profile.
    func testProfileTab() {
        launchSignedIn()
        XCTAssertTrue(app.buttons["Home"].waitForExistence(timeout: 15))
        snapshot("profile-01-home")
        // Up to the tab bar, then right to the last tab.
        press(.up, 2)
        press(.right, 6)
        Thread.sleep(forTimeInterval: 2)
        snapshot("profile-02-tab")
        XCTAssertTrue(app.buttons["Switch Profile"].waitForExistence(timeout: 5), "the profile tab should show Settings")
        press(.down, pause: 1)
        snapshot("profile-03-settings")
    }

    /// Movies tab genre chips, then a cast member's page from a movie's detail page.
    func testGenresAndPerson() {
        let movie = ProcessInfo.processInfo.environment["STRATA_TEST_MOVIE"] ?? "10378"
        launchSignedIn(["-StrataTab", "movies"])
        XCTAssertTrue(app.buttons["All"].waitForExistence(timeout: 15), "genre chips should show on Movies")
        press(.down, pause: 1)
        press(.right, pause: 1)
        press(.select, pause: 3)
        snapshot("genre-01-selected")
        press(.down, pause: 1.5)
        snapshot("genre-02-rails")

        app.terminate()
        launchSignedIn(["-StrataOpenURL", "strata://movie/\(movie)"])
        XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 15))
        // Down from the hero to the first cast member, then open their page.
        press(.down, pause: 1.5)
        snapshot("person-00-cast-focused")
        press(.select, pause: 4)
        snapshot("person-01-page")
        press(.down, pause: 1.5)
        snapshot("person-02-credits")
    }

    /// App Store screenshots from the demo server (apps/server/scripts/demo). Runs only with
    /// TEST_RUNNER_STRATA_DEMO_SERVER=<address>, on a fresh simulator, and writes to
    /// TEST_RUNNER_STRATA_SHOTS.
    func testAppStoreScreenshots() throws {
        guard let server = ProcessInfo.processInfo.environment["STRATA_DEMO_SERVER"] else { throw XCTSkip("needs STRATA_DEMO_SERVER") }
        app.launchArguments = ["-StrataServer", server]
        app.launch()
        // A server that needs an account (the hosted demo): STRATA_DEMO_USER / STRATA_DEMO_PASSWORD.
        let usePassword = app.buttons["Use Password Instead"]
        if usePassword.waitForExistence(timeout: 30), let user = ProcessInfo.processInfo.environment["STRATA_DEMO_USER"],
           let password = ProcessInfo.processInfo.environment["STRATA_DEMO_PASSWORD"] {
            while !usePassword.hasFocus { press(.down) }
            press(.select, pause: 1.5)
            for (field, text) in [(app.textFields["Username"], user), (app.secureTextFields["Password"], password)] {
                XCTAssertTrue(field.waitForExistence(timeout: 10))
                var presses = 0
                while !field.hasFocus && presses < 6 { press(.down); presses += 1 }
                press(.select, pause: 1)
                app.typeText(text)
                press(.menu, pause: 1)
            }
            let signIn = app.buttons["Sign In"]
            var presses = 0
            while !signIn.hasFocus && presses < 6 { press(.down); presses += 1 }
            press(.select, pause: 3)
        }
        XCTAssertTrue(app.staticTexts["Who's watching?"].waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 2)
        snapshot("05-profiles")
        press(.select, pause: 3) // Alex, focused first
        XCTAssertTrue(app.buttons["More Info"].waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 4) // artwork
        snapshot("01-home")

        let open = { (link: String) in
            self.app.terminate()
            self.app.launchArguments = ["-StrataOpenURL", link]
            self.app.launch()
        }
        open("strata://movie/16093") // Carnival of Souls
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Play' OR label BEGINSWITH 'Resume'")).firstMatch.waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 4)
        snapshot("02-title")

        open("strata://show/1018") // Bonanza
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Play' OR label BEGINSWITH 'Resume'")).firstMatch.waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 2)
        // Down to the season picker: the header and the first episodes stay on screen
        // (episodes not in the library can't take focus, so a further press skips ahead).
        press(.down, pause: 1.5)
        Thread.sleep(forTimeInterval: 2)
        snapshot("03-episodes")

        open("strata://watch/movie/992") // Sherlock Jr., resumed mid-scene
        Thread.sleep(forTimeInterval: 14)
        press(.up, pause: 1) // controls
        snapshot("04-player")
    }

    /// Home: the hero carousel moves on with right/left past its buttons, and down
    /// reaches the rails below it.
    func testHomeHeroCarousel() {
        launchSignedIn(["-StrataTab", "home"])
        XCTAssertTrue(app.buttons["More Info"].waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 2)
        let focused = { self.app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true")) }
        press(.down, pause: 1.2)
        print("CAROUSEL focus: \(focused().label)")
        snapshot("home-01-hero-focused")
        press(.right, 3, pause: 1.2) // Play → More Info → next title
        print("CAROUSEL after right: \(focused().label)")
        snapshot("home-02-next-title")
        press(.left, 2, pause: 1.2)
        snapshot("home-03-back")
        press(.down, pause: 1.5)
        print("CAROUSEL after down: \(focused().label)")
        snapshot("home-04-rails")
    }

    /// Show page: a focused episode row stays readable (dark lift, not the white platter).
    func testEpisodeRowFocus() {
        let show = ProcessInfo.processInfo.environment["STRATA_TEST_SHOW"] ?? "37854"
        launchSignedIn(["-StrataOpenURL", "strata://show/\(show)"])
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Play' OR label BEGINSWITH 'Resume'")).firstMatch.waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 2)
        press(.down, 2, pause: 1.5)
        snapshot("episode-01-focused")
        press(.down, pause: 1.5)
        snapshot("episode-02-next")
    }

    /// Anime tab: the category menu, a category's rails, a title, and back.
    func testAnimeTab() {
        launchSignedIn(["-StrataTab", "anime"])
        XCTAssertTrue(app.buttons["Filter by category"].waitForExistence(timeout: 20), "the Anime tab should show its category menu")
        Thread.sleep(forTimeInterval: 3)
        let focused = { self.app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true")) }
        snapshot("anime-01-top")
        press(.down, pause: 1)
        print("ANIME after down 1: \(focused().label)")
        snapshot("anime-02-menu-focused")
        press(.down, pause: 1.5)
        print("ANIME after down 2: \(focused().label)")
        snapshot("anime-03-first-rail")
        press(.down, 2, pause: 1.5)
        snapshot("anime-04-more-rails")
        press(.up, 3, pause: 1)
        print("ANIME back up: \(focused().label)")
        press(.select, pause: 1.5)
        snapshot("anime-05-menu-open")
        press(.down, 6, pause: 0.5) // All Anime, Action … Isekai
        press(.select, pause: 6)
        snapshot("anime-06-isekai")
        press(.down, pause: 1.5)
        print("ANIME isekai rail: \(focused().label)")
        snapshot("anime-07-isekai-rail")
        press(.select, pause: 4)
        snapshot("anime-08-detail")
        press(.menu, pause: 2)
        snapshot("anime-09-back")
    }

    func testBrowseFocusAndPlay() {
        launchSignedIn()
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
