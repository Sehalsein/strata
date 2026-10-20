// Strata.app: runs the Strata server in the background with a menu bar item,
// the way Jellyfin's Mac app does. No Dock icon, no login item; quitting stops
// the server. The server itself (Contents/MacOS/strata-server) stays headless,
// so the same binary also runs on a NAS or from a terminal.

import AppKit
import CryptoKit

private let port = 8420
// 127.0.0.1, not localhost: another program could sit on the IPv6 address.
private let dashboardURL = URL(string: "http://127.0.0.1:\(port)")!
private let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/Strata/server.log")

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var stateItem: NSMenuItem!
    private var openItem: NSMenuItem!
    private var restartItem: NSMenuItem!
    /// The server this app started. The app only ever opens the dashboard of this one.
    private var server: Process?
    /// Shared with the server it starts (as hex text, which is also the HMAC key on both
    /// sides); the server proves itself with it (see isOurs).
    private let launchSecret: String = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }.map { String(format: "%02x", $0) }.joined()
    private var quitting = false

    private var signalSources: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A termination signal (kill, logout) quits like the menu does, stopping the server first.
        for sig in [SIGTERM, SIGINT, SIGHUP] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signalSources.append(source)
        }
        buildMenu()
        Task { await start(openDashboard: !UserDefaults.standard.bool(forKey: "openedOnce")) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quitting = true
        guard let server, server.isRunning else { return .terminateNow }
        server.terminate() // SIGTERM: the server finishes its shutdown (sessions, database)
        DispatchQueue.global().async {
            let deadline = Date().addingTimeInterval(10)
            while server.isRunning, Date() < deadline { usleep(100_000) }
            if server.isRunning { kill(server.processIdentifier, SIGKILL) }
            DispatchQueue.main.async { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    // MARK: Server

    private func start(openDashboard: Bool) async {
        setState("Starting…", running: false)
        // Something already on the port isn't ours, whatever it says it is: don't use it.
        if await isServing() {
            portTaken()
            return
        }
        do {
            try launchServer()
        } catch {
            setState("Couldn't start: \(error.localizedDescription)", running: false)
            return
        }
        var up = false
        for _ in 0..<60 {
            guard server?.isRunning == true else { return } // exited: the termination handler says why
            if await isOurs() { up = true; break }
            try? await Task.sleep(for: .milliseconds(500))
        }
        guard up, server?.isRunning == true else {
            setState("Didn't start. See Show Logs.", running: false)
            return
        }
        setState("Running on port \(port)", running: true)
        if openDashboard {
            UserDefaults.standard.set(true, forKey: "openedOnce")
            self.openDashboard()
        }
    }

    private func portTaken() {
        setState("Port \(port) is in use by another program. Quit it, then choose Restart Server.", running: false)
    }

    private func launchServer() throws {
        let bundle = Bundle.main.bundleURL
        let process = Process()
        process.executableURL = bundle.appendingPathComponent("Contents/MacOS/strata-server")
        process.arguments = ["serve", "--port", String(port)]
        var env = ProcessInfo.processInfo.environment
        // The server stops itself if this app disappears without stopping it (crash, force quit).
        env["STRATA_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        env["STRATA_LAUNCH_SECRET"] = launchSecret
        let ffmpegDir = bundle.appendingPathComponent("Contents/Resources/ffmpeg")
        if FileManager.default.fileExists(atPath: ffmpegDir.appendingPathComponent("ffmpeg").path) {
            env["STRATA_FFMPEG"] = ffmpegDir.appendingPathComponent("ffmpeg").path
            env["STRATA_FFPROBE"] = ffmpegDir.appendingPathComponent("ffprobe").path
        }
        process.environment = env

        try FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        let log = try FileHandle(forWritingTo: logURL)
        log.seekToEndOfFile()
        process.standardOutput = log
        process.standardError = log

        process.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                guard let self, !self.quitting else { return }
                // Exit right after starting usually means the port was taken.
                if await self.isServing() { self.portTaken() }
                else { self.setState("Stopped (exit \(proc.terminationStatus)). See Show Logs.", running: false) }
            }
        }
        try process.run()
        server = process
    }

    /// Whether the server answering on the port is the one this app started: it must
    /// return the HMAC of a fresh random challenge under the secret only it was given.
    private func isOurs() async -> Bool {
        guard server?.isRunning == true else { return false }
        let challenge = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        var request = URLRequest(url: dashboardURL.appendingPathComponent("api/launcher/proof"))
        request.timeoutInterval = 2
        request.setValue(challenge, forHTTPHeaderField: "X-Strata-Challenge")
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let proof = json["proof"] as? String
        else { return false }
        let expected = HMAC<SHA256>.authenticationCode(for: Data(challenge.utf8), using: SymmetricKey(data: Data(launchSecret.utf8)))
            .map { String(format: "%02x", $0) }.joined()
        return proof == expected
    }

    private func isServing() async -> Bool {
        var request = URLRequest(url: dashboardURL.appendingPathComponent("api/info"))
        request.timeoutInterval = 1
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return json["name"] as? String == "strata"
    }

    // MARK: Menu

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = Self.markImage()
        statusItem.button?.toolTip = "Strata"

        let menu = NSMenu()
        menu.autoenablesItems = false // we decide what's enabled (Open Dashboard only when ours runs)
        stateItem = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
        stateItem.isEnabled = false
        menu.addItem(stateItem)
        menu.addItem(.separator())
        openItem = item("Open Dashboard", #selector(openDashboard), "d")
        menu.addItem(openItem)
        menu.addItem(item("Show Logs", #selector(showLogs), "l"))
        restartItem = item("Restart Server", #selector(restart), "r")
        menu.addItem(restartItem)
        menu.addItem(.separator())
        menu.addItem(item("Quit Strata", #selector(NSApplication.terminate(_:)), "q"))
        statusItem.menu = menu
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = action == #selector(NSApplication.terminate(_:)) ? NSApp : self
        return item
    }

    private func setState(_ text: String, running: Bool) {
        NSLog("Strata: %@", text) // visible in Console.app
        stateItem.title = "Strata: \(text)"
        openItem.isEnabled = running
        statusItem.button?.appearsDisabled = !running
    }

    /// Opens the dashboard only after the server answering proves it's the one this app started.
    @objc private func openDashboard() {
        Task {
            guard await isOurs() else {
                setState("Couldn't verify the server on port \(port). Choose Restart Server.", running: false)
                return
            }
            NSWorkspace.shared.open(dashboardURL)
        }
    }

    @objc private func showLogs() { NSWorkspace.shared.open(logURL) }

    @objc private func restart() {
        server?.terminationHandler = nil
        server?.terminate()
        server?.waitUntilExit()
        Task { await start(openDashboard: false) }
    }

    /// The Strata mark (three bands forming a play triangle) as a template image.
    private static func markImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { rect in
            let s = rect.height / 520
            func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: (x - 292) * s + 1, y: (y - 254) * s) }
            let bands: [[NSPoint]] = [
                [p(300, 262), p(552, 399), p(300, 399)],
                [p(300, 443), p(633, 443), p(760, 512), p(633, 581), p(300, 581)],
                [p(300, 625), p(552, 625), p(300, 762)],
            ]
            NSColor.black.setFill()
            for points in bands {
                let path = NSBezierPath()
                path.move(to: points[0])
                points.dropFirst().forEach { path.line(to: $0) }
                path.close()
                path.fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
    app.run()
}
