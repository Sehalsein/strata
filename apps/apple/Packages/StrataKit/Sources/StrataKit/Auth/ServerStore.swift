import Foundation
import Observation
import Security

/// A Strata server this device is signed in to.
public struct SavedServer: Codable, Sendable, Hashable, Identifiable {
    /// Stable server id from `/api/info`.
    public let id: String
    /// Display name (the server's `serverName`).
    public var name: String
    /// Known addresses, e.g. LAN + Tailscale. The first one is used; the rest are
    /// fallbacks tried when it can't be reached.
    public var addresses: [URL]
    public var username: String
    public var profileId: Int?
    public var profileName: String?
    public var version: String?
    public var isAdmin: Bool?

    public init(id: String, name: String, addresses: [URL], username: String, profileId: Int? = nil,
                profileName: String? = nil, version: String? = nil, isAdmin: Bool? = nil) {
        self.id = id
        self.name = name
        self.addresses = addresses
        self.username = username
        self.profileId = profileId
        self.profileName = profileName
        self.version = version
        self.isAdmin = isAdmin
    }

    /// The address in use.
    public var url: URL { addresses[0] }
    public var hasProfile: Bool { profileId != nil }
}

/// Where tokens live. The default keeps them in the Keychain and mirrors to
/// UserDefaults, so "stay signed in" survives when the Keychain is unavailable
/// (unsigned simulator builds, MDM restrictions).
public struct TokenStorage: Sendable {
    public var read: @Sendable (_ serverId: String) -> String?
    public var write: @Sendable (_ token: String?, _ serverId: String) -> Void

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

/// Signed-in servers, the active one, and its profile. Replaces the Jellyfin `AuthStore`.
///
/// Typical flow:
/// 1. `probe("192.168.1.20")` → show the server name (optional), or pick from `ServerBrowser`.
/// 2. `signIn(address:username:password:)`.
/// 3. If `needsProfileSelection`, show `profiles()` and call `selectProfile(id:pin:)`.
/// 4. Use `client` for everything else.
@MainActor
@Observable
public final class ServerStore {
    public private(set) var servers: [SavedServer] = []
    public private(set) var activeID: String?
    /// Authenticated client for the active server (nil when signed out).
    public private(set) var client: StrataClient?
    /// Signed in, but this token isn't bound to a profile yet (show the picker).
    public private(set) var needsProfileSelection = false
    public private(set) var isAuthenticating = false
    public var lastError: String?

    public var active: SavedServer? { servers.first { $0.id == activeID } }
    public var isSignedIn: Bool { client != nil }

    private let defaults: UserDefaults
    private let tokens: TokenStorage
    private let session: URLSession

    private static let serversKey = "strata.servers"
    private static let activeKey = "strata.activeServer"
    private static let legacyCleanupKey = "strata.legacyCleanup.v1"

    public init(defaults: UserDefaults = .standard, tokens: TokenStorage = .keychain, session: URLSession = StrataNetworking.apiSession) {
        self.defaults = defaults
        self.tokens = tokens
        self.session = session
        Self.cleanUpLegacyJellyfinState(defaults)
        if let data = defaults.data(forKey: Self.serversKey),
           let saved = try? JSONDecoder().decode([SavedServer].self, from: data) {
            // A server whose token is gone can't be used; drop it.
            servers = saved.filter { !$0.addresses.isEmpty && tokens.read($0.id) != nil }
        }
        // Re-save each token so one stored before the Keychain-only change loses its
        // plaintext UserDefaults copy (the write clears it once the Keychain holds the token).
        for server in servers { if let token = tokens.read(server.id) { tokens.write(token, server.id) } }
        activeID = defaults.string(forKey: Self.activeKey).flatMap { id in servers.contains { $0.id == id } ? id : nil } ?? servers.first?.id
        rebuildClient()
        Log.auth.info("ServerStore hydrated: \(self.servers.count, privacy: .public) server(s), active=\(self.activeID ?? "none", privacy: .public)")
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

    // MARK: - Sign in / out

    /// Signs in and makes the server active. Re-signing in to a known server (same id)
    /// updates it in place and adds the new address. Returns false and sets `lastError` on failure.
    @discardableResult
    public func signIn(address: String, username: String, password: String) async -> Bool {
        isAuthenticating = true
        lastError = nil
        defer { isAuthenticating = false }
        do {
            let (url, info) = try await probeServer(address)
            if info.setupRequired {
                throw StrataError(kind: .invalidInput, message: "\(info.serverName) hasn't been set up yet. Open its dashboard in a browser to create the admin account.")
            }
            let anon = StrataClient(baseURL: url, session: session)
            let token = try await anon.login(username: username.trimmingCharacters(in: .whitespaces), password: password)
            let authed = anon.withToken(token)
            let me = try await authed.me()

            var server = servers.first { $0.id == info.id } ?? SavedServer(id: info.id, name: info.serverName, addresses: [], username: me.user.username)
            if let old = tokens.read(server.id), old != token, let oldURL = server.addresses.first {
                // Replace the previous session on that server (best-effort).
                let previous = StrataClient(baseURL: oldURL, token: old, session: session, cacheTTL: 0)
                Task { try? await previous.logout() }
            }
            server.name = info.serverName
            server.version = info.version
            server.username = me.user.username
            server.isAdmin = me.user.isAdmin
            server.addresses = [url] + server.addresses.filter { $0 != url }
            server.profileId = me.profile?.id
            server.profileName = me.profile?.name
            tokens.write(token, server.id)
            upsert(server)
            activate(server.id)
            Log.auth.info("signIn ok server=\(server.id, privacy: .public) user=\(server.username, privacy: .private)")
            return true
        } catch {
            let e = StrataError.wrap(error)
            lastError = e.status == 401 ? "Wrong username or password." : e.message
            Log.auth.error("signIn failed: \(e.message, privacy: .public)")
            return false
        }
    }

    /// Logs out of the active server and forgets it. Switches to another saved server if any.
    public func signOut() async {
        guard let id = activeID else { return }
        if let client { try? await client.logout() }
        forget(id)
    }

    /// Forgets a saved server (and its token) without contacting it.
    public func removeServer(_ id: String) {
        if let server = servers.first(where: { $0.id == id }), let token = tokens.read(id) {
            let c = StrataClient(baseURL: server.url, token: token, session: session, cacheTTL: 0)
            Task { try? await c.logout() }
        }
        forget(id)
    }

    public func switchServer(_ id: String) {
        guard servers.contains(where: { $0.id == id }), id != activeID else { return }
        activate(id)
        lastError = nil
        Log.auth.info("switched server to \(id, privacy: .public)")
    }

    // MARK: - Profiles

    public func profiles() async throws -> [Profile] {
        guard let client else { throw Self.signedOut }
        return try await client.profiles()
    }

    /// Binds the active token to a profile and remembers it. Throws `StrataError`
    /// (403 "Wrong PIN") so a PIN prompt can show it inline; also sets `lastError`.
    public func selectProfile(id: Int, pin: String? = nil) async throws {
        guard let client, var server = active else { throw Self.signedOut }
        do {
            try await client.selectProfile(id: id, pin: pin)
            let name = try? await client.me().profile?.name
            server.profileId = id
            server.profileName = name ?? server.profileName
            upsert(server)
            needsProfileSelection = false
            lastError = nil
        } catch {
            let e = StrataError.wrap(error)
            lastError = e.message
            throw e
        }
    }

    /// Re-shows the profile picker (e.g. "Switch Profile").
    public func requestProfileSelection() {
        guard client != nil else { return }
        needsProfileSelection = true
    }

    // MARK: - Connection

    /// Checks the active server: finds a reachable address (trying fallbacks, verifying the
    /// server id), validates the token and refreshes the profile. Call at launch / foreground.
    /// Returns false and sets `lastError` when the server can't be used.
    @discardableResult
    public func connect() async -> Bool {
        guard var server = active, let token = tokens.read(server.id) else { return false }
        do {
            let url = try await reachableAddress(for: server)
            if url != server.url {
                server.addresses = [url] + server.addresses.filter { $0 != url }
                upsert(server)
                rebuildClient()
            }
            let me = try await StrataClient(baseURL: url, token: token, session: session, cacheTTL: 0).me()
            server.profileId = me.profile?.id
            server.profileName = me.profile?.name ?? server.profileName
            server.isAdmin = me.user.isAdmin
            upsert(server)
            needsProfileSelection = me.profile == nil
            lastError = nil
            return true
        } catch {
            let e = StrataError.wrap(error)
            if e.isUnauthorized {
                lastError = "Your session on \(server.name) has expired. Sign in again."
                forget(server.id)
            } else {
                lastError = e.message
            }
            return false
        }
    }

    /// Call when a request on `client` failed: on a connectivity error, tries the other
    /// addresses and switches to one that answers. Returns true if `client` changed
    /// (retry the request). A 401 signs the server out.
    @discardableResult
    public func recover(from error: Error) async -> Bool {
        let e = StrataError.wrap(error)
        guard var server = active else { return false }
        if e.isUnauthorized {
            lastError = "Your session on \(server.name) has expired. Sign in again."
            forget(server.id)
            return false
        }
        if e.needsProfile {
            needsProfileSelection = true
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
        guard var server = servers.first(where: { $0.id == id }) else { throw Self.signedOut }
        let (url, info) = try await probeServer(address)
        guard info.id == server.id else {
            throw StrataError(kind: .invalidInput, message: "That address belongs to a different server (\(info.serverName)).")
        }
        if !server.addresses.contains(url) { server.addresses.append(url) }
        upsert(server)
    }

    public func removeAddress(_ url: URL, from id: String) {
        guard var server = servers.first(where: { $0.id == id }), server.addresses.count > 1 else { return }
        server.addresses.removeAll { $0 == url }
        upsert(server)
        if id == activeID { rebuildClient() }
    }

    /// Makes `url` the address used for that server.
    public func setPreferredAddress(_ url: URL, for id: String) {
        guard var server = servers.first(where: { $0.id == id }), server.addresses.contains(url) else { return }
        server.addresses = [url] + server.addresses.filter { $0 != url }
        upsert(server)
        if id == activeID { rebuildClient() }
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

    private func activate(_ id: String) {
        activeID = id
        defaults.set(id, forKey: Self.activeKey)
        rebuildClient()
    }

    private func forget(_ id: String) {
        tokens.write(nil, id)
        servers.removeAll { $0.id == id }
        persist()
        if activeID == id {
            if let next = servers.first { activate(next.id) } else {
                activeID = nil
                defaults.removeObject(forKey: Self.activeKey)
                rebuildClient()
            }
        }
    }

    private func rebuildClient() {
        guard let server = active, let token = tokens.read(server.id) else {
            client = nil
            needsProfileSelection = false
            return
        }
        client = StrataClient(baseURL: server.url, token: token, session: session)
        needsProfileSelection = server.profileId == nil
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(servers) {
            defaults.set(data, forKey: Self.serversKey)
        }
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
