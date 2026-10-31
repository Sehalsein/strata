import Foundation
import Observation
import Security

/// A Strata server this device has signed in to (with one or more accounts).
public struct SavedServer: Codable, Sendable, Hashable, Identifiable {
    /// Stable server id from `/api/info`.
    public let id: String
    /// Display name (the server's `serverName`).
    public var name: String
    /// Known addresses, e.g. LAN + Tailscale. The first one is used; the rest are
    /// fallbacks tried when it can't be reached.
    public var addresses: [URL]
    public var version: String?
    /// A name given on this device; kept over the server's own when signing in again.
    public var customName: String?

    public init(id: String, name: String, addresses: [URL], version: String? = nil) {
        self.id = id
        self.name = name
        self.addresses = addresses
        self.version = version
    }

    /// The address in use.
    public var url: URL { addresses[0] }
}

/// One account signed in on this device: who, on which server, in which household. Each
/// person's account is their profile; "Who's watching?" lists these. The token is kept
/// in the Keychain under the sign-in's id.
public struct SavedSignIn: Codable, Sendable, Hashable, Identifiable {
    /// `<server id>|<account id>`: one sign-in per account per server.
    public let id: String
    public let serverID: String
    public let userID: String
    public var username: String?
    /// The account's display name.
    public var name: String
    /// The active household; nil until one is chosen.
    public var household: Household?
    /// Signed in without a password (a home-network join, a TV): can watch, not administer.
    public var viewerOnly: Bool
    public var isServerAdmin: Bool
    /// Signed in with a temporary password from an admin: a new one comes first.
    public var mustChangePassword: Bool?

    public init(serverID: String, userID: String, username: String?, name: String, household: Household? = nil,
                viewerOnly: Bool = false, isServerAdmin: Bool = false) {
        self.id = Self.id(server: serverID, user: userID)
        self.serverID = serverID
        self.userID = userID
        self.username = username
        self.name = name
        self.household = household
        self.viewerOnly = viewerOnly
        self.isServerAdmin = isServerAdmin
    }

    public static func id(server: String, user: String) -> String { "\(server)|\(user)" }

    /// First letter, for avatar placeholders.
    public var initial: String { name.first.map { String($0).uppercased() } ?? "?" }
    public var isKids: Bool { household?.isKids ?? false }
}

/// Where tokens live. The default keeps them in the Keychain and mirrors to
/// UserDefaults, so "stay signed in" survives when the Keychain is unavailable
/// (unsigned simulator builds, MDM restrictions).
public struct TokenStorage: Sendable {
    public var read: @Sendable (_ id: String) -> String?
    public var write: @Sendable (_ token: String?, _ id: String) -> Void

    public init(read: @escaping @Sendable (String) -> String?, write: @escaping @Sendable (String?, String) -> Void) {
        self.read = read
        self.write = write
    }

    public static let keychain = TokenStorage(
        read: { id in
            Keychain.get("strata.token.\(id)") ?? UserDefaults.standard.string(forKey: "strata.token.fallback.\(id)")
        },
        write: { token, id in
            let fallbackKey = "strata.token.fallback.\(id)"
            guard let token else {
                Keychain.set(nil, for: "strata.token.\(id)")
                UserDefaults.standard.removeObject(forKey: fallbackKey)
                return
            }
            let status = Keychain.set(token, for: "strata.token.\(id)")
            if status == errSecSuccess {
                // The Keychain holds it; never keep a plaintext copy.
                UserDefaults.standard.removeObject(forKey: fallbackKey)
            } else {
                // Only when the Keychain is unusable (e.g. an unsigned simulator build).
                Log.auth.warning("Keychain write failed (\(status)); using UserDefaults fallback")
                UserDefaults.standard.set(token, forKey: fallbackKey)
            }
        }
    )

    /// For tests and previews.
    public static func inMemory() -> TokenStorage {
        let box = TokenBox()
        return TokenStorage(read: { box.get($0) }, write: { box.set($1, $0) })
    }
}

private final class TokenBox: @unchecked Sendable {
    private var tokens: [String: String] = [:]
    private let lock = NSLock()
    func get(_ id: String) -> String? { lock.lock(); defer { lock.unlock() }; return tokens[id] }
    func set(_ id: String, _ token: String?) { lock.lock(); defer { lock.unlock() }; tokens[id] = token }
}

/// The device's saved sign-ins (across servers), the active one, and its client.
///
/// Typical flow:
/// 1. `probeServer("192.168.1.20")`, or pick one from `ServerBrowser`.
/// 2. `signIn(address:login:password:)`; on a home network `homeJoinChoices(url:)` then
///    `join(url:info:userId:)`; on a TV a phone-approved code, then `signIn(token:url:info:)`.
/// 3. If `needsHousehold`, show `households()` and call `chooseHousehold(_:)`.
/// 4. Use `client` for everything else. `switchTo(_:)` changes account (and server).
@MainActor
@Observable
public final class ServerStore {
    public private(set) var servers: [SavedServer] = []
    public private(set) var signIns: [SavedSignIn] = []
    /// The active sign-in's id. Nil with saved sign-ins means "Who's watching?".
    public private(set) var activeID: String?
    /// Authenticated client for the active sign-in (nil when none is active).
    public private(set) var client: StrataClient?
    public private(set) var isAuthenticating = false
    public var lastError: String?

    public var active: SavedSignIn? { signIns.first { $0.id == activeID } }
    /// The active sign-in's server.
    public var activeServer: SavedServer? { active.flatMap { server(id: $0.serverID) } }
    public var isSignedIn: Bool { client != nil }
    /// Signed in, but this session has no household yet (show the picker).
    public var needsHousehold: Bool { active != nil && active?.household == nil }

    public func server(id: String) -> SavedServer? { servers.first { $0.id == id } }
    public func server(for signIn: SavedSignIn) -> SavedServer? { server(id: signIn.serverID) }

    private let defaults: UserDefaults
    private let tokens: TokenStorage
    private let session: URLSession

    private static let serversKey = "strata.servers.v2"
    private static let signInsKey = "strata.signIns.v2"
    private static let activeKey = "strata.activeSignIn.v2"
    /// Before accounts (one token per server, bound to a profile).
    private static let profileEraServersKey = "strata.servers"
    private static let profileEraActiveKey = "strata.activeServer"
    private static let legacyCleanupKey = "strata.legacyCleanup.v1"

    public init(defaults: UserDefaults = .standard, tokens: TokenStorage = .keychain, session: URLSession = StrataNetworking.apiSession) {
        self.defaults = defaults
        self.tokens = tokens
        self.session = session
        Self.cleanUpLegacyJellyfinState(defaults)
        Self.dropProfileEraSignIns(defaults, tokens)
        let decoder = JSONDecoder()
        if let data = defaults.data(forKey: Self.serversKey), let saved = try? decoder.decode([SavedServer].self, from: data) {
            servers = saved.filter { !$0.addresses.isEmpty }
        }
        if let data = defaults.data(forKey: Self.signInsKey), let saved = try? decoder.decode([SavedSignIn].self, from: data) {
            // A sign-in whose token is gone (or whose server is) can't be used; drop it.
            signIns = saved.filter { s in tokens.read(s.id) != nil && servers.contains { $0.id == s.serverID } }
        }
        servers.removeAll { server in !signIns.contains { $0.serverID == server.id } }
        activeID = defaults.string(forKey: Self.activeKey).flatMap { id in signIns.contains { $0.id == id } ? id : nil }
            ?? (signIns.count == 1 ? signIns.first?.id : nil)
        rebuildClient()
        Log.auth.info("ServerStore hydrated: \(self.signIns.count, privacy: .public) sign-in(s), active=\(self.activeID ?? "none", privacy: .public)")
    }

    // MARK: - Probe

    /// Normalises a typed address (adds `http://` and port 8420 when missing) and checks
    /// it's a compatible Strata server.
    public func probe(_ address: String) async throws -> ServerInfo {
        try await probeServer(address).info
    }

    /// `probe`, also returning the normalised URL that answered.
    public func probeServer(_ address: String) async throws -> (url: URL, info: ServerInfo) {
        guard let url = ServerAddress.normalize(address) else {
            throw StrataError(kind: .invalidInput, message: "That doesn't look like a valid server address.")
        }
        let info: ServerInfo
        do {
            info = try await StrataClient(baseURL: url, session: session, cacheTTL: 0).info()
        } catch let e as StrataError where e.kind == .decoding || e.status == 404 {
            throw StrataError(kind: .notStrata, message: "\(ServerAddress.display(url)) isn't a Strata server.")
        }
        guard info.isStrata else {
            throw StrataError(kind: .notStrata, message: "\(ServerAddress.display(url)) isn't a Strata server.")
        }
        guard info.isCompatible else {
            let newer = info.apiVersion > ServerInfo.supportedAPIVersion
            throw StrataError(kind: .incompatible, message: newer
                ? "\(info.serverName) runs a newer Strata (\(info.version)). Update this app to connect."
                : "\(info.serverName) runs an older Strata (\(info.version)). Update the server to connect.")
        }
        return (url, info)
    }

    // MARK: - Sign in

    /// Signs in with a username (or email) and password, saves the sign-in and makes it
    /// active. Signing in again to the same account replaces its old session. Returns
    /// false and sets `lastError` on failure.
    @discardableResult
    public func signIn(address: String, login: String, password: String) async -> Bool {
        isAuthenticating = true
        lastError = nil
        defer { isAuthenticating = false }
        do {
            let (url, info) = try await probeServer(address)
            if info.setupRequired {
                throw StrataError(kind: .invalidInput, message: "\(info.serverName) hasn't been set up yet. Open its dashboard in a browser to create the admin account.")
            }
            let anon = StrataClient(baseURL: url, session: session, cacheTTL: 0)
            let token = try await anon.signIn(login: login, password: password)
            try await adopt(token: token, url: url, info: info)
            Log.auth.info("signIn ok server=\(info.id, privacy: .public)")
            return true
        } catch {
            let e = StrataError.wrap(error)
            lastError = e.status == 401 ? "Wrong username or password." : e.message
            Log.auth.error("signIn failed: \(e.message, privacy: .public)")
            return false
        }
    }

    /// On a home server's network: who can be picked to join without a password.
    public func homeJoinChoices(url: URL) async throws -> HomeJoinChoices {
        try await StrataClient(baseURL: url, session: session, cacheTTL: 0).homeJoinChoices()
    }

    /// Joins a home server as `userId` without a password (watch-only), then makes that
    /// sign-in active. Returns false and sets `lastError` on failure.
    @discardableResult
    public func join(url: URL, info: ServerInfo, userId: String) async -> Bool {
        isAuthenticating = true
        lastError = nil
        defer { isAuthenticating = false }
        do {
            let token = try await StrataClient(baseURL: url, session: session, cacheTTL: 0).join(userId: userId)
            try await adopt(token: token, url: url, info: info)
            Log.auth.info("join ok server=\(info.id, privacy: .public)")
            return true
        } catch {
            lastError = StrataError.wrap(error).message
            Log.auth.error("join failed: \(StrataError.wrap(error).message, privacy: .public)")
            return false
        }
    }

    /// Signs in with a member's QR code (from the server's dashboard): saves the sign-in
    /// and makes it active. The device can watch, not administer.
    @discardableResult
    public func signIn(code: String, url: URL) async -> Bool {
        isAuthenticating = true
        lastError = nil
        defer { isAuthenticating = false }
        do {
            let client = StrataClient(baseURL: url, session: session, cacheTTL: 0)
            let info = try await client.info()
            let token = try await client.signIn(code: code)
            try await adopt(token: token, url: url, info: info)
            Log.auth.info("signIn by QR code ok server=\(info.id, privacy: .public)")
            return true
        } catch {
            lastError = StrataError.wrap(error).message
            Log.auth.error("signIn by QR code failed: \(StrataError.wrap(error).message, privacy: .public)")
            return false
        }
    }

    /// Finishes a sign-in that produced `token` some other way (a TV approved by code from
    /// a phone): saves it and makes it active.
    @discardableResult
    public func signIn(token: String, url: URL, info: ServerInfo) async -> Bool {
        lastError = nil
        do {
            try await adopt(token: token, url: url, info: info)
            Log.auth.info("signIn by code ok server=\(info.id, privacy: .public)")
            return true
        } catch {
            lastError = StrataError.wrap(error).message
            return false
        }
    }

    /// A client for any saved sign-in (the active one's, when it's that one).
    public func client(forSignIn id: String) -> StrataClient? {
        guard let signIn = signIns.first(where: { $0.id == id }), let server = server(for: signIn), let token = tokens.read(id) else { return nil }
        if id == activeID, let client { return client }
        return StrataClient(baseURL: server.url, token: token, session: session, cacheTTL: 0)
    }

    /// Saves `token` for the account it belongs to on the server at `url`, and makes that
    /// sign-in active. A known server (same id) gains the new address.
    private func adopt(token: String, url: URL, info: ServerInfo) async throws {
        let me = try await StrataClient(baseURL: url, token: token, session: session, cacheTTL: 0).me()

        var server = server(id: info.id) ?? SavedServer(id: info.id, name: info.serverName, addresses: [])
        server.name = server.customName ?? info.serverName
        server.version = info.version
        server.addresses = [url] + server.addresses.filter { $0 != url }
        upsert(server)

        let id = SavedSignIn.id(server: info.id, user: me.user.id)
        if let old = tokens.read(id), old != token {
            // The account signed in again on this device: end its previous session (best-effort).
            let previous = StrataClient(baseURL: url, token: old, session: session, cacheTTL: 0)
            Task { try? await previous.signOut() }
        }
        var signIn = SavedSignIn(serverID: info.id, userID: me.user.id, username: me.user.username, name: me.user.name)
        signIn.apply(me)
        tokens.write(token, id)
        upsert(signIn)
        activate(id)
    }

    // MARK: - Switching and signing out

    /// Makes a saved sign-in the active one: the whole app follows it (server, account,
    /// household).
    public func switchTo(_ id: String) {
        guard signIns.contains(where: { $0.id == id }) else { return }
        lastError = nil
        guard id != activeID else { return }
        activate(id)
        Log.auth.info("switched sign-in to \(id, privacy: .public)")
    }

    /// Back to "Who's watching?" without signing anyone out.
    public func deactivate() {
        activeID = nil
        defaults.removeObject(forKey: Self.activeKey)
        rebuildClient()
    }

    /// Signs the active account out on its server and forgets it here. "Who's watching?"
    /// shows next if other sign-ins remain.
    public func signOut() async {
        guard let id = activeID else { return }
        if let client { try? await client.signOut() }
        forget(id)
    }

    /// Signs a saved sign-in out (best-effort) and forgets it.
    public func remove(_ id: String) {
        if let c = client(forSignIn: id) {
            Task { try? await c.signOut() }
        }
        forget(id)
    }

    /// Names a saved server on this device.
    public func renameServer(_ id: String, to name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let i = servers.firstIndex(where: { $0.id == id }) else { return }
        servers[i].name = name
        servers[i].customName = name
        persist()
    }

    public func signIns(onServer id: String) -> [SavedSignIn] { signIns.filter { $0.serverID == id } }

    // MARK: - Households

    /// The active account's households.
    public func households() async throws -> [HouseholdSummary] {
        guard let client else { throw Self.signedOut }
        return try await client.households()
    }

    /// Switches the active session to another of the account's households.
    public func chooseHousehold(_ id: String) async throws {
        guard let client, var signIn = active else { throw Self.signedOut }
        do {
            try await client.setActiveHousehold(id)
            signIn.apply(try await client.me())
            upsert(signIn)
            // A fresh client: nothing cached from the other household's library.
            rebuildClient()
            lastError = nil
        } catch {
            let e = StrataError.wrap(error)
            lastError = e.message
            throw e
        }
    }

    // MARK: - Account

    /// Changes the active account's password, which signs it out everywhere else; this
    /// device keeps going with the new session the server returns. Throws `StrataError`
    /// (400 "Invalid password" when `current` is wrong).
    public func changePassword(current: String, new: String) async throws {
        guard let client, let signIn = active else { throw Self.signedOut }
        guard let token = try await client.changePassword(current: current, new: new) else { return }
        tokens.write(token, signIn.id)
        rebuildClient()
        // The new session starts without the household when the account has several.
        if let household = signIn.household, let fresh = self.client, (try? await fresh.me())?.household == nil {
            try? await fresh.setActiveHousehold(household.id)
        }
        await refreshActive()
    }

    // MARK: - Connection

    /// Checks the active sign-in: finds a reachable address (trying fallbacks, verifying the
    /// server id), validates the token and refreshes the account and household. Call at
    /// launch, on switching and on return to the foreground. Returns false and sets
    /// `lastError` when it can't be used.
    @discardableResult
    public func connect() async -> Bool {
        guard let signIn = active, var server = server(for: signIn), let token = tokens.read(signIn.id) else { return false }
        do {
            let url = try await reachableAddress(for: server)
            if url != server.url {
                server.addresses = [url] + server.addresses.filter { $0 != url }
                upsert(server)
                rebuildClient()
            }
            let me = try await StrataClient(baseURL: url, token: token, session: session, cacheTTL: 0).me()
            update(signIn.id) { $0.apply(me) }
            lastError = nil
            return true
        } catch {
            let e = StrataError.wrap(error)
            if e.isUnauthorized {
                lastError = "\(signIn.name)'s session on \(server.name) has expired. Sign in again."
                forget(signIn.id)
            } else {
                lastError = e.message
            }
            return false
        }
    }

    /// Re-reads the active account and household from the server (best-effort).
    public func refreshActive() async {
        guard let id = activeID, let client, let me = try? await client.me() else { return }
        update(id) { $0.apply(me) }
    }

    /// Call when a request on `client` failed: on a connectivity error, tries the other
    /// addresses and switches to one that answers. Returns true if `client` changed
    /// (retry the request). A 401 signs the account out here; a 409 asks for a household.
    @discardableResult
    public func recover(from error: Error) async -> Bool {
        let e = StrataError.wrap(error)
        guard let signIn = active, var server = server(for: signIn) else { return false }
        if e.isUnauthorized {
            lastError = "\(signIn.name)'s session on \(server.name) has expired. Sign in again."
            forget(signIn.id)
            return false
        }
        if e.needsHousehold {
            update(signIn.id) { $0.household = nil }
            return false
        }
        guard e.isConnectivity, server.addresses.count > 1,
              let url = try? await reachableAddress(for: server, skipping: server.url) else { return false }
        server.addresses = [url] + server.addresses.filter { $0 != url }
        upsert(server)
        rebuildClient()
        Log.auth.info("failed over to \(url.absoluteString, privacy: .private)")
        return true
    }

    /// Adds another address for a saved server after checking it reaches the same server.
    public func addAddress(_ address: String, to id: String) async throws {
        guard var server = server(id: id) else { throw Self.signedOut }
        let (url, info) = try await probeServer(address)
        guard info.id == server.id else {
            throw StrataError(kind: .invalidInput, message: "That address belongs to a different server (\(info.serverName)).")
        }
        if !server.addresses.contains(url) { server.addresses.append(url) }
        upsert(server)
    }

    public func removeAddress(_ url: URL, from id: String) {
        guard var server = server(id: id), server.addresses.count > 1 else { return }
        server.addresses.removeAll { $0 == url }
        upsert(server)
        if active?.serverID == id { rebuildClient() }
    }

    /// Makes `url` the address used for that server.
    public func setPreferredAddress(_ url: URL, for id: String) {
        guard var server = server(id: id), server.addresses.contains(url) else { return }
        server.addresses = [url] + server.addresses.filter { $0 != url }
        upsert(server)
        if active?.serverID == id { rebuildClient() }
    }

    /// The saved server a link names: by id, or by one of its addresses (same scheme,
    /// host and port). Never an address the device hasn't signed in to.
    public func savedServer(matching value: String) -> SavedServer? {
        if let byID = server(id: value) { return byID }
        guard let url = ServerAddress.normalize(value) ?? URL(string: value) else { return nil }
        return servers.first { $0.addresses.contains { StrataClient.sameOrigin($0, url) } }
    }

    // MARK: - Internals

    private static let signedOut = StrataError(kind: .http, status: 401, message: "Not signed in.")

    private func reachableAddress(for server: SavedServer, skipping: URL? = nil) async throws -> URL {
        var firstError: Error?
        for url in server.addresses where url != skipping {
            do {
                let info = try await StrataClient(baseURL: url, session: session, cacheTTL: 0).info()
                if info.id == server.id { return url }
            } catch {
                if firstError == nil { firstError = error }
            }
        }
        throw firstError ?? StrataError(kind: .network, message: "Can't reach \(server.name) at any of its addresses.")
    }

    private func upsert(_ server: SavedServer) {
        if let i = servers.firstIndex(where: { $0.id == server.id }) {
            servers[i] = server
        } else {
            servers.append(server)
        }
        persist()
    }

    private func upsert(_ signIn: SavedSignIn) {
        if let i = signIns.firstIndex(where: { $0.id == signIn.id }) {
            signIns[i] = signIn
        } else {
            signIns.append(signIn)
        }
        persist()
    }

    private func update(_ id: String, _ change: (inout SavedSignIn) -> Void) {
        guard var signIn = signIns.first(where: { $0.id == id }) else { return }
        let before = signIn
        change(&signIn)
        if signIn != before { upsert(signIn) }
    }

    private func activate(_ id: String) {
        activeID = id
        defaults.set(id, forKey: Self.activeKey)
        rebuildClient()
    }

    private func forget(_ id: String) {
        tokens.write(nil, id)
        let serverID = signIns.first { $0.id == id }?.serverID
        signIns.removeAll { $0.id == id }
        // A server with no one signed in to it is forgotten too.
        if let serverID, !signIns.contains(where: { $0.serverID == serverID }) {
            servers.removeAll { $0.id == serverID }
        }
        persist()
        if activeID == id {
            // With one sign-in left, it's who's watching; with several, ask.
            if signIns.count == 1, let only = signIns.first { activate(only.id) } else { deactivate() }
        }
    }

    private func rebuildClient() {
        guard let signIn = active, let server = server(for: signIn), let token = tokens.read(signIn.id) else {
            client = nil
            return
        }
        client = StrataClient(baseURL: server.url, token: token, session: session)
    }

    private func persist() {
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(servers) { defaults.set(data, forKey: Self.serversKey) }
        if let data = try? encoder.encode(signIns) { defaults.set(data, forKey: Self.signInsKey) }
    }

    /// Sign-ins from before accounts (one token per server, bound to a profile) don't
    /// work on servers with accounts: forget them and their tokens, once.
    private static func dropProfileEraSignIns(_ defaults: UserDefaults, _ tokens: TokenStorage) {
        guard let data = defaults.data(forKey: profileEraServersKey) else { return }
        struct Old: Decodable { var id: String }
        for server in (try? JSONDecoder().decode([Old].self, from: data)) ?? [] {
            tokens.write(nil, server.id)
        }
        defaults.removeObject(forKey: profileEraServersKey)
        defaults.removeObject(forKey: profileEraActiveKey)
        defaults.removeObject(forKey: "strata.keychainOnly.v1")
        Log.auth.info("Dropped sign-ins from before accounts")
    }

    /// The Jellyfin-era keys are ignored; clear them out once.
    private static func cleanUpLegacyJellyfinState(_ defaults: UserDefaults) {
        guard !defaults.bool(forKey: legacyCleanupKey) else { return }
        // Every Jellyfin token, found by prefix so orphaned items go too. The flag is set
        // only once this succeeds, so a failure retries on the next launch.
        let removedTokens = Keychain.deleteAll(prefix: "strata.accessToken")
        for key in ["strata.userId", "strata.userName", "strata.serverURL", "strata.savedEndpoints", "strata.accounts"] {
            defaults.removeObject(forKey: key)
        }
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("strata.accessToken") {
            defaults.removeObject(forKey: key)
        }
        if removedTokens { defaults.set(true, forKey: legacyCleanupKey) }
    }
}

extension SavedSignIn {
    /// Takes the account and household from `/api/me`.
    mutating func apply(_ me: Me) {
        username = me.user.username
        name = me.user.name
        household = me.household
        viewerOnly = me.viewerOnly
        isServerAdmin = me.user.isServerAdmin
        mustChangePassword = me.mustChangePassword
    }
}
