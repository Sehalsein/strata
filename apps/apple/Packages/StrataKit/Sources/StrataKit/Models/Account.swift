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
