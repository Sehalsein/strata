import Foundation
import os

/// Centralized `os_log` categories. Subsystem is the app's bundle id; categories
/// are scoped per concern so we can filter logs like
/// `xcrun simctl spawn booted log show --predicate 'subsystem == "com.sehalsein.strata"'`.
public enum Log {
    private static let subsystem = "com.sehalsein.strata"

    public static let auth   = Logger(subsystem: subsystem, category: "auth")
    public static let net    = Logger(subsystem: subsystem, category: "net")
    public static let detail = Logger(subsystem: subsystem, category: "detail")
    public static let player = Logger(subsystem: subsystem, category: "player")
}
