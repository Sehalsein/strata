import Foundation

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

    public static let clientName = "Strata"
    public static let clientVersion = "0.1.0"
}
