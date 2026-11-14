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
    /// "home" or "cloud". Absent from older servers.
    public var mode: String?
    /// Setup asks for the code from the server's log (true unless asked from its own machine).
    public var setupCodeRequired: Bool?
    /// This device is on the server's home network and may join without a password,
    /// picking a member of the household. Absent from older servers.
    public var localJoin: Bool?
    /// Ways in besides a password this server is set up for. Absent from older servers.
    public var signIn: SignInMethods?

    public struct SignInMethods: Codable, Sendable, Hashable {
        public var google: Bool?
        public var passkey: Bool?
        /// "Forgot password?" works: the server can email a reset link.
        public var passwordReset: Bool?
    }

    public init(name: String = "strata", serverName: String, id: String, version: String, apiVersion: Int, setupRequired: Bool,
                mode: String? = nil, setupCodeRequired: Bool? = nil, localJoin: Bool? = nil) {
        self.name = name
        self.serverName = serverName
        self.id = id
        self.version = version
        self.apiVersion = apiVersion
        self.setupRequired = setupRequired
        self.mode = mode
        self.setupCodeRequired = setupCodeRequired
        self.localJoin = localJoin
    }

    /// The API version this client speaks.
    public static let supportedAPIVersion = 1

    public var isStrata: Bool { name == "strata" }
    public var isCompatible: Bool { apiVersion == Self.supportedAPIVersion }
}

/// A household (a Better Auth organization) as the signed-in account sees it: its role
/// there and its own settings (kids, content limit) for that household.
public struct Household: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// "owner", "admin" or "member" (Better Auth may join several with commas).
    public var role: String
    /// The content limit the household set for this account ("none", "kids", …).
    public var contentLimit: String?
    /// A kids account: the server hides titles above its limit.
    public var isKids: Bool

    public init(id: String, name: String, role: String = "member", contentLimit: String? = nil, isKids: Bool = false) {
        self.id = id
        self.name = name
        self.role = role
        self.contentLimit = contentLimit
        self.isKids = isKids
    }

    private var roles: [String] { role.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } }
    public var isOwner: Bool { roles.contains("owner") }
    /// Owner or admin: runs the household (from the web dashboard).
    public var isAdmin: Bool { isOwner || roles.contains("admin") }
    /// "Owner", "Admin" or "Member", for display.
    public var roleLabel: String { isOwner ? String(localized: "Owner", bundle: .module) : isAdmin ? String(localized: "Admin", bundle: .module) : String(localized: "Member", bundle: .module) }
}

/// `GET /api/me`: the signed-in account, and its household on this device.
public struct Me: Codable, Sendable, Hashable {
    public struct User: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        /// Absent for accounts made without one (they sign in by email).
        public var username: String?
        /// Display name.
        public var name: String
        public var email: String?
        /// The profile picture's path on the server (`/api/avatars/<id>.png`); nil for none.
        public var image: String?
        /// Runs the server (the account made at setup), signed in with a password.
        public var isServerAdmin: Bool

        public init(id: String, username: String?, name: String, email: String? = nil, image: String? = nil, isServerAdmin: Bool = false) {
            self.id = id
            self.image = image
            self.username = username
            self.name = name
            self.email = email
            self.isServerAdmin = isServerAdmin
        }
    }

    public var user: User
    /// Signed in without a password (a home-network join, a TV): can watch, never administer.
    public var viewerOnly: Bool
    /// The active household; nil until one is chosen (requests then answer 409).
    public var household: Household?
    /// Signed in with a temporary password from an admin: until a new one is chosen, the
    /// server answers nothing else. Absent from older servers.
    public var mustChangePassword: Bool?

    public init(user: User, viewerOnly: Bool = false, household: Household? = nil) {
        self.user = user
        self.viewerOnly = viewerOnly
        self.household = household
    }
}

/// One of the account's households, from `GET /api/auth/organization/list`.
public struct HouseholdSummary: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// `POST /api/join {}` on a home server: the household and who can be picked.
public struct HomeJoinChoices: Codable, Sendable, Hashable {
    public struct Member: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        /// The profile picture's path on the server; nil for none.
        public var image: String?
        public var isKids: Bool

        public init(id: String, name: String, image: String? = nil, isKids: Bool = false) {
            self.id = id
            self.image = image
            self.name = name
            self.isKids = isKids
        }

        /// First letter, for avatar placeholders.
        public var initial: String { name.first.map { String($0).uppercased() } ?? "?" }
    }

    public var household: HouseholdSummary
    public var members: [Member]
}

/// `POST /api/auth/device/code` (RFC 8628): the code a TV shows, and the secret it polls with.
public struct DeviceCode: Codable, Sendable, Hashable {
    public var deviceCode: String
    public var userCode: String
    public var verificationURI: String
    /// `<server>/link?user_code=…`: what the TV's QR code opens.
    public var verificationURIComplete: String?
    /// Seconds.
    public var expiresIn: Int
    /// Seconds between polls.
    public var interval: Int

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationURI = "verification_uri"
        case verificationURIComplete = "verification_uri_complete"
        case expiresIn = "expires_in"
        case interval
    }

    public init(deviceCode: String, userCode: String, verificationURI: String, verificationURIComplete: String?, expiresIn: Int, interval: Int) {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationURI = verificationURI
        self.verificationURIComplete = verificationURIComplete
        self.expiresIn = expiresIn
        self.interval = interval
    }

    /// "K7QF-2MXD", easier to read off a TV.
    public var displayCode: String { Self.display(userCode) }

    /// The link the TV's QR code shows. The server's own when it gave one, else built from
    /// the address the TV reached it at.
    public func qrURL(server: URL) -> URL? {
        if let complete = verificationURIComplete, let url = URL(string: complete), url.scheme != nil { return url }
        guard var parts = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return nil }
        parts.path = "/link"
        parts.queryItems = [URLQueryItem(name: "user_code", value: userCode)]
        return parts.url
    }

    /// Upper-case letters and digits only, as the server matches it.
    public static func normalize(_ code: String) -> String {
        String(code.uppercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) && $0.isASCII }.map(Character.init))
    }

    /// An 8-character code split in two halves.
    public static func display(_ code: String) -> String {
        let code = normalize(code)
        return code.count == 8 ? "\(code.prefix(4))-\(code.suffix(4))" : code
    }
}

/// One poll of `POST /api/auth/device/token`.
public enum DeviceTokenPoll: Sendable, Equatable {
    /// Not approved yet: poll again after the interval.
    case pending
    /// Polled too often: wait 5 s longer between polls.
    case slowDown
    /// Approved: the bearer token (a session that can watch, in the approver's household).
    case approved(token: String)
    /// The code ran out; get a new one.
    case expired
    /// Declined on the phone.
    case denied
}

/// `GET /api/auth/device?user_code=…`: the code as the approving phone sees it. Opening it
/// signed in claims it for that account, which is what lets it approve.
public struct DeviceCodeStatus: Codable, Sendable, Hashable {
    public var userCode: String
    /// "pending", "approved" or "denied".
    public var status: String
    public var clientId: String?

    enum CodingKeys: String, CodingKey {
        case userCode = "user_code"
        case status
        case clientId = "client_id"
    }

    public var isPending: Bool { status == "pending" }
}

/// A sign-in's answer: the token is in the `set-auth-token` header and the body.
struct SignInResponse: Codable, Sendable {
    var token: String?
}

struct TokenResponse: Codable, Sendable {
    var token: String
}

struct ItemsResponse<T: Codable & Sendable>: Codable, Sendable {
    var items: [T]

    init(items: [T]) { self.items = items }

    /// Titles this app can't use are left out of the list rather than failing it.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if T.self is ListItem.Type {
            var list = try container.nestedUnkeyedContainer(forKey: .items)
            items = list.decodeLossy(T.self)
        } else {
            items = try container.decode([T].self, forKey: .items)
        }
    }
}

struct ShelvesResponse: Codable, Sendable {
    var shelves: [Shelf]
}

struct OKResponse: Codable, Sendable {
    var ok: Bool?
}

/// One of the server's profile pictures (original characters drawn for Strata).
public struct Avatar: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// `#rrggbb`, the picture's background: a placeholder colour while it loads.
    public var background: String
    /// Path on the server (`/api/avatars/<id>.png`): what a profile's `image` holds.
    public var url: String

    public init(id: String, name: String, background: String, url: String) {
        self.id = id
        self.name = name
        self.background = background
        self.url = url
    }
}

/// `GET /api/avatars`: the pictures in the groups pickers show them in.
public struct AvatarGroup: Codable, Sendable, Hashable, Identifiable {
    public var title: String
    public var avatars: [Avatar]
    public var id: String { title }

    public init(title: String, avatars: [Avatar]) {
        self.title = title
        self.avatars = avatars
    }
}
