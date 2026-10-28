// Strata.app: runs the Strata server in the background with a menu bar item,
// the way Jellyfin's Mac app does. No Dock icon; starts at login (a menu toggle);
// quitting stops the server. The server itself (Contents/MacOS/strata-server) stays
// headless, so the same binary also runs on a NAS or from a terminal.
//
// The app runs a copy of its server from Application Support, so the server can update
// itself without touching this signed app; installing a newer Strata.app refreshes the copy.

import AppKit
import CryptoKit
import ServiceManagement

private let port = 8420
// 127.0.0.1, not localhost: another program could sit on the IPv6 address.
private let dashboardURL = URL(string: "http://127.0.0.1:\(port)")!
private let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/Strata/server.log")
/// The server copy the app runs (and updates replace), next to the server's own data.
private let installDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Strata/app")

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var stateItem: NSMenuItem!
    private var openItem: NSMenuItem!
    private var restartItem: NSMenuItem!
    private var loginItem: NSMenuItem!
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
        // A home server should come back on its own: on by default the first time, then it's the toggle's.
        if !UserDefaults.standard.bool(forKey: "loginItemSetUp") {
            UserDefaults.standard.set(true, forKey: "loginItemSetUp")
            try? SMAppService.mainApp.register()
        }
        updateLoginItem()
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

    /// The server to run: the copy in Application Support, put there (or refreshed) from this
    /// app whenever this app's version differs from the one that copy came from. Updates
    /// the server installs on its own replace the copy and leave the marker alone.
    private func installedServer() throws -> URL {
        let fm = FileManager.default
        let bundled = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/strata-server")
        let installed = installDir.appendingPathComponent("strata-server")
        let marker = installDir.appendingPathComponent("installed-from")
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let installedFrom = try? String(contentsOf: marker, encoding: .utf8)
        if !fm.fileExists(atPath: installed.path) || installedFrom != appVersion {
            try fm.createDirectory(at: installDir, withIntermediateDirectories: true)
            let staging = installDir.appendingPathComponent("strata-server.installing")
            try? fm.removeItem(at: staging)
            try fm.copyItem(at: bundled, to: staging)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: staging.path)
            if fm.fileExists(atPath: installed.path) { _ = try fm.replaceItemAt(installed, withItemAt: staging) }
            else { try fm.moveItem(at: staging, to: installed) }
            try appVersion.write(to: marker, atomically: true, encoding: .utf8)
            NSLog("Strata: installed server %@ to %@", appVersion, installed.path)
        }
        return installed
    }

    private func launchServer() throws {
        let bundle = Bundle.main.bundleURL
        let process = Process()
        process.executableURL = try installedServer()
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
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200, data.count < 1_024,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let proofHex = json["proof"] as? String,
              let proof = Data(hexString: proofHex), proof.count == SHA256.byteCount
        else { return false }
        // The proof covers the port too; checked in constant time.
        return HMAC<SHA256>.isValidAuthenticationCode(proof, authenticating: Data("\(challenge)|\(port)".utf8),
                                                     using: SymmetricKey(data: Data(launchSecret.utf8)))
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
        loginItem = item("Start at Login", #selector(toggleLoginItem), "")
        menu.addItem(loginItem)
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

    @objc private func toggleLoginItem() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled { try service.unregister() } else { try service.register() }
        } catch {
            NSLog("Strata: login item: %@", error.localizedDescription)
        }
        updateLoginItem()
    }

    private func updateLoginItem() {
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

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

extension Data {
    init?(hexString: String) {
        guard hexString.count.isMultiple(of: 2) else { return nil }
        var bytes = [UInt8]()
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let next = hexString.index(index, offsetBy: 2)
            guard let byte = UInt8(hexString[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
    app.run()
}
