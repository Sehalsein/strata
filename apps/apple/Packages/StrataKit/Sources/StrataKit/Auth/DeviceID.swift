import Foundation
#if canImport(UIKit)
import UIKit
#endif

public enum DeviceID {
    private static let key = "strata.deviceId"

    public static func getOrCreate() -> String {
        if let existing = Keychain.get(key) { return existing }
        let id = UUID().uuidString
        Keychain.set(id, for: key)
        return id
    }
}

public enum DeviceInfo {
    public static var modelName: String {
        #if os(macOS)
        return "Mac"
        #elseif os(iOS)
        var sysinfo = utsname()
        uname(&sysinfo)
        let raw = withUnsafePointer(to: &sysinfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
        return raw.isEmpty ? "iOS" : raw
        #else
        return "Apple"
        #endif
    }

    /// Device class shown in the server's session list: "iPhone", "iPad", "Apple TV", "Mac".
    public static var deviceClass: String {
        #if os(tvOS)
        return "Apple TV"
        #elseif os(macOS)
        return "Mac"
        #elseif os(visionOS)
        return "Vision Pro"
        #else
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? modelName
        return model.hasPrefix("iPad") ? "iPad" : "iPhone"
        #endif
    }

    /// Sent as `deviceName` on login, e.g. "Strata on iPhone" or "Strata on Mac (studio)".
    public static var deviceName: String {
        #if os(macOS)
        let host = ProcessInfo.processInfo.hostName
            .replacingOccurrences(of: ".local", with: "")
        if !host.isEmpty, host != "localhost" { return "Strata on Mac (\(host))" }
        #endif
        return "Strata on \(deviceClass)"
    }

    /// The hardware model: "iPhone17,1", "AppleTV14,1" (the simulated one on the simulator).
    public static let modelIdentifier: String = {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !simulated.isEmpty { return simulated }
        var sysinfo = utsname()
        uname(&sysinfo)
        let raw = withUnsafePointer(to: &sysinfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
        return raw.isEmpty ? deviceClass : raw
    }()

    /// The device's own name ("Living Room", or "iPhone" where the system keeps the
    /// person's name private), read once on the main thread at launch by `captureName()`.
    nonisolated(unsafe) public private(set) static var ownName: String?

    /// Reads the device's name for `headers`. Call once at launch, before any request.
    @MainActor
    public static func captureName() {
        #if canImport(UIKit) && !os(watchOS)
        ownName = UIDevice.current.name
        #else
        ownName = ProcessInfo.processInfo.hostName.replacingOccurrences(of: ".local", with: "")
        #endif
    }

    /// "Strata/0.3.0 (iPhone; iOS 27.0)": the app, the kind of device and its system.
    public static let userAgent: String = {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? clientVersion
        let os = ProcessInfo.processInfo.operatingSystemVersion
        #if os(tvOS)
        let system = "tvOS"
        #elseif os(macOS)
        let system = "macOS"
        #else
        let system = deviceClass == "iPad" ? "iPadOS" : "iOS"
        #endif
        let osVersion = os.patchVersion > 0 ? "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)" : "\(os.majorVersion).\(os.minorVersion)"
        return "\(clientName)/\(version) (\(deviceClass); \(system) \(osVersion))"
    }()

    /// Sent with every request, for the server's Devices page.
    public static var headers: [String: String] {
        var headers = ["User-Agent": userAgent, "X-Strata-Device-Model": modelIdentifier]
        if let ownName, !ownName.isEmpty { headers["X-Strata-Device-Name"] = ownName }
        return headers
    }

    public static let clientName = "Strata"
    public static let clientVersion = "0.1.0"
}
