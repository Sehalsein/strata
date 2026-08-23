import Foundation
import Security

/// Thin Keychain wrapper for tokens and the device ID. Failures are logged
/// via `Log.auth` so the simulator console reveals real OSStatus codes
/// (`errSecAuthFailed`, `errSecMissingEntitlement`, etc.) instead of silently
/// dropping writes.
public enum Keychain {
    public static let service = "com.sehalsein.strata"

    @discardableResult
    public static func set(_ value: String?, for key: String) -> OSStatus {
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(baseQuery as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return errSecParam }
        var insert = baseQuery
        insert[kSecValueData as String] = data
        // `AfterFirstUnlock` (no `ThisDeviceOnly`) is what Apple recommends
        // when there's no compelling reason to forbid restore-to-new-device.
        // It also avoids a known class of simulator quirks where the stricter
        // accessibility silently rejected writes.
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(insert as CFDictionary, nil)
        if status != errSecSuccess {
            Log.auth.error("Keychain set \(key, privacy: .public) failed: \(Self.message(status), privacy: .public) (\(status))")
        }
        return status
    }

    public static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        if status != errSecSuccess {
            Log.auth.error("Keychain get \(key, privacy: .public) failed: \(Self.message(status), privacy: .public) (\(status))")
            return nil
        }
        guard let data = item as? Data, let s = String(data: data, encoding: .utf8) else { return nil }
        return s
    }

    private static func message(_ status: OSStatus) -> String {
        if let cf = SecCopyErrorMessageString(status, nil) {
            return cf as String
        }
        return "OSStatus \(status)"
    }
}
