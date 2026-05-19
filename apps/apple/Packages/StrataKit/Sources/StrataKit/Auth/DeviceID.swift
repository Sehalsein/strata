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

    public static let clientName = "Strata"
    public static let clientVersion = "0.1.0"
}
