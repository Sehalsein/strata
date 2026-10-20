import Foundation

/// `GET /api/info` (public).
public struct ServerInfo: Codable, Sendable, Hashable {
    /// Always "strata" — used to tell a Strata server from anything else on that port.
    public var name: String
    /// Display name set by the admin.
    public var serverName: String
    /// Stable per-install id.
    public var id: String
    public var version: String
    public var apiVersion: Int
    public var setupRequired: Bool

    public init(name: String = "strata", serverName: String, id: String, version: String, apiVersion: Int, setupRequired: Bool) {
        self.name = name
        self.serverName = serverName
        self.id = id
        self.version = version
        self.apiVersion = apiVersion
        self.setupRequired = setupRequired
    }

    /// The API version this client speaks.
    public static let supportedAPIVersion = 1

    public var isStrata: Bool { name == "strata" }
    public var isCompatible: Bool { apiVersion == Self.supportedAPIVersion }
}

public struct Profile: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String
    public var avatar: String?
    public var hasPin: Bool

    public init(id: Int, name: String, avatar: String? = nil, hasPin: Bool = false) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.hasPin = hasPin
    }

    /// First letter, for avatar placeholders.
    public var initial: String { name.first.map { String($0).uppercased() } ?? "?" }
}

/// `GET /api/me`
public struct Me: Codable, Sendable, Hashable {
    public struct User: Codable, Sendable, Hashable, Identifiable {
        public var id: Int
        public var username: String
        public var isAdmin: Bool
    }

    /// The selected profile (no `hasPin` here).
    public struct ProfileRef: Codable, Sendable, Hashable, Identifiable {
        public var id: Int
        public var name: String
        public var avatar: String?
    }

    public var user: User
    public var profile: ProfileRef?
}

/// `POST /api/auth/device`: a code for this device to show, and the secret it polls with.
public struct DeviceLink: Codable, Sendable, Hashable {
    public var code: String
    public var pollToken: String
    public var expiresAt: Double
    public var pollIntervalMs: Int

    public var expiresDate: Date { Date(timeIntervalSince1970: expiresAt / 1000) }
    /// "K7QF-2MXD", easier to read off a TV.
    public var displayCode: String { code.count == 8 ? "\(code.prefix(4))-\(code.suffix(4))" : code }

    /// The link a phone opens to approve this code. It names the server by id only:
    /// the phone approves with a server it's already signed in to, never an address
    /// read from a QR code.
    public func approvalURL(serverID: String) -> URL? {
        var parts = URLComponents()
        parts.scheme = "strata"
        parts.host = "link"
        parts.queryItems = [
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "server", value: serverID),
        ]
        return parts.url
    }

    /// Upper-case letters and digits only, as the server stores it.
    public static func normalize(_ code: String) -> String {
        String(code.uppercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) && $0.isASCII }.map(Character.init))
    }

    public init(code: String, pollToken: String, expiresAt: Double, pollIntervalMs: Int) {
        self.code = code
        self.pollToken = pollToken
        self.expiresAt = expiresAt
        self.pollIntervalMs = pollIntervalMs
    }
}

public struct DeviceLinkPoll: Codable, Sendable {
    public enum Status: String, Codable, Sendable { case pending, approved, expired }
    public var status: Status
    public var token: String?
}

public struct PendingDeviceLink: Codable, Sendable {
    public var deviceName: String
    public var expiresAt: Double
}

struct TokenResponse: Codable, Sendable {
    var token: String
}

struct ItemsResponse<T: Codable & Sendable>: Codable, Sendable {
    var items: [T]
}

struct ShelvesResponse: Codable, Sendable {
    var shelves: [Shelf]
}

struct OKResponse: Codable, Sendable {
    var ok: Bool?
}
