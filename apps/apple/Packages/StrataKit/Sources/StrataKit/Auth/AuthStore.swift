import Foundation
import Observation
import os

public struct Session: Equatable, Sendable, Codable, Identifiable {
    public let serverURL: URL
    public let token: String
    public let userId: String
    public let userName: String?

    /// One saved entry per server+user, so re-adding the same account updates
    /// in place rather than duplicating.
    public var id: String { serverURL.absoluteString + "|" + userId }
}

@MainActor
@Observable
public final class AuthStore {
    public private(set) var session: Session?
    /// Saved Jellyfin accounts (profiles). Each is a real user with its own
    /// token; switching between them swaps the active token/user. Account
    /// identity is the Jellyfin `userId` (a server-assigned GUID), which is
    /// stable across endpoint switches — so re-pointing an account at a
    /// different address (see `savedEndpoints`) does not orphan its token.
    public private(set) var savedAccounts: [Session] = []
    /// Saved server addresses (endpoints) for the *active* account. Switching
    /// between them only swaps the base URL — the token/user stay the same,
    /// e.g. reaching one server over LAN, a domain, or a VPN. Includes the
    /// active endpoint.
    public private(set) var savedEndpoints: [URL] = []
    public private(set) var isAuthenticating = false
    public private(set) var lastError: String?

    // Active-account pointer + active endpoint. Kept under the original keys so
    // existing installs hydrate unchanged.
    private static let userIdKey = "strata.userId"
    private static let userNameDefault = "strata.userName"
    private static let serverURLDefault = "strata.serverURL"
    private static let savedEndpointsDefault = "strata.savedEndpoints"
    /// JSON array of non-secret account metadata ({serverURL, userId, userName}).
    /// Tokens live in the Keychain, keyed per account.
    private static let accountsDefault = "strata.accounts"

    // Per-account token storage. The Keychain is primary; we always mirror to
    // UserDefaults so "stay signed in" survives when the Keychain is
    // unavailable (simulator without signed entitlements, MDM restrictions).
    private static func tokenKey(_ userId: String) -> String { "strata.accessToken.\(userId)" }
    private static func tokenFallbackKey(_ userId: String) -> String { "strata.accessToken.fallback.\(userId)" }
    // Legacy single-account keys, read once for migration.
    private static let legacyTokenKey = "strata.accessToken"
    private static let legacyTokenFallbackKey = "strata.accessToken.fallback"

    public init() {
        Self.migrateLegacyIfNeeded()
        self.savedAccounts = Self.hydrateAccounts()
        self.session = Self.hydrateActive(from: savedAccounts)
        self.savedEndpoints = Self.hydrateSavedEndpoints()
        // Migrate: ensure the active endpoint is represented in the list.
        if let s = session, !savedEndpoints.contains(s.serverURL) {
            savedEndpoints.append(s.serverURL)
            persistSavedEndpoints()
        }
        if let s = session {
            Log.auth.info("Session hydrated for user=\(s.userId, privacy: .public) (\(self.savedAccounts.count, privacy: .public) account(s))")
        } else {
            Log.auth.info("Session NOT hydrated")
        }
    }

    public var client: JellyfinClient? {
        session.map { JellyfinClient(session: $0) }
    }

    // MARK: - Sign in / Accounts

    /// Authenticate and add the account (or refresh it if it already exists),
    /// then switch to it. Used both for first sign-in and "Add Account".
    public func signIn(serverURL: URL, username: String, password: String) async {
        isAuthenticating = true
        lastError = nil
        defer { isAuthenticating = false }
        let probe = JellyfinClient(unauthenticated: serverURL)
        do {
            let result = try await probe.authenticate(username: username, password: password)
            let s = Session(
                serverURL: serverURL,
                token: result.accessToken,
                userId: result.user.id,
                userName: result.user.name
            )
            upsertAccount(s)
            activate(s)
            upsertEndpoint(s.serverURL)
            Log.auth.info("signIn ok user=\(s.userId, privacy: .public)")
        } catch {
            let msg = (error as? JellyfinClient.RequestError)?.message ?? error.localizedDescription
            lastError = msg
            Log.auth.error("signIn failed: \(msg, privacy: .public)")
        }
    }

    /// Switch the active profile to a previously saved account. Token/user are
    /// already stored — no network call, no password.
    public func switchAccount(to userId: String) {
        guard let account = savedAccounts.first(where: { $0.userId == userId }),
              account.userId != session?.userId else { return }
        activate(account)
        // The endpoint list is per-account; reset it to the account's address.
        savedEndpoints = [account.serverURL]
        persistSavedEndpoints()
        Log.auth.info("switched account to user=\(userId, privacy: .public)")
    }

    /// Remove a saved account and its stored token. If the active account is
    /// removed, falls back to another; if none remain, signs out entirely.
    public func removeAccount(_ userId: String) {
        Keychain.set(nil, for: Self.tokenKey(userId))
        UserDefaults.standard.removeObject(forKey: Self.tokenFallbackKey(userId))
        savedAccounts.removeAll { $0.userId == userId }
        persistAccounts()
        if session?.userId == userId {
            if let next = savedAccounts.first {
                switchAccount(to: next.userId)
            } else {
                clearActive()
            }
        }
    }

    /// Sign out of the *active* account only (removes it). Remaining profiles
    /// stay signed in; if it was the last one, the app returns to login.
    public func signOut() {
        if let userId = session?.userId {
            removeAccount(userId)
        } else {
            clearActive()
        }
    }

    // MARK: - Endpoints (addresses for the active account)

    /// Add a server address to the list without switching to it. No network
    /// call — auth stays the same; only the set of known endpoints changes.
    public func addEndpoint(_ url: URL) {
        upsertEndpoint(url)
    }

    /// Point the current session at a different saved endpoint. The token and
    /// user are unchanged — only the base URL the client talks to changes.
    public func switchEndpoint(to url: URL) {
        guard let s = session, s.serverURL != url else {
            upsertEndpoint(url)
            return
        }
        let updated = Session(serverURL: url, token: s.token, userId: s.userId, userName: s.userName)
        upsertAccount(updated)
        activate(updated)
        upsertEndpoint(url)
        Log.auth.info("switched endpoint to \(url.absoluteString, privacy: .public)")
    }

    /// Remove a saved endpoint. Keeps at least one; if the active endpoint is
    /// removed, falls back to another.
    public func removeEndpoint(_ url: URL) {
        guard savedEndpoints.count > 1 else { return }
        savedEndpoints.removeAll { $0 == url }
        if session?.serverURL == url, let next = savedEndpoints.first {
            switchEndpoint(to: next)
        } else {
            persistSavedEndpoints()
        }
    }

    private func upsertEndpoint(_ url: URL) {
        if !savedEndpoints.contains(url) {
            savedEndpoints.append(url)
            persistSavedEndpoints()
        }
    }

    private func persistSavedEndpoints() {
        let strings = savedEndpoints.map(\.absoluteString)
        UserDefaults.standard.set(strings, forKey: Self.savedEndpointsDefault)
    }

    private static func hydrateSavedEndpoints() -> [URL] {
        let strings = UserDefaults.standard.stringArray(forKey: savedEndpointsDefault) ?? []
        return strings.compactMap(URL.init(string:))
    }

    // MARK: - Account persistence

    /// Add or update an account in-place (identity = userId), persisting its
    /// token and metadata.
    private func upsertAccount(_ s: Session) {
        persistToken(s.token, for: s.userId)
        if let idx = savedAccounts.firstIndex(where: { $0.userId == s.userId }) {
            savedAccounts[idx] = s
        } else {
            savedAccounts.append(s)
        }
        persistAccounts()
    }

    /// Make `s` the active session and persist the active-account pointer.
    private func activate(_ s: Session) {
        session = s
        UserDefaults.standard.set(s.userId, forKey: Self.userIdKey)
        UserDefaults.standard.set(s.userName, forKey: Self.userNameDefault)
        UserDefaults.standard.set(s.serverURL.absoluteString, forKey: Self.serverURLDefault)
    }

    private func clearActive() {
        session = nil
        UserDefaults.standard.removeObject(forKey: Self.userIdKey)
        UserDefaults.standard.removeObject(forKey: Self.userNameDefault)
    }

    private func persistToken(_ token: String, for userId: String) {
        let kcStatus = Keychain.set(token, for: Self.tokenKey(userId))
        UserDefaults.standard.set(token, forKey: Self.tokenFallbackKey(userId))
        if kcStatus != errSecSuccess {
            Log.auth.warning("Keychain write failed (\(kcStatus)); relying on UserDefaults fallback")
        }
    }

    private static func token(for userId: String) -> String? {
        Keychain.get(tokenKey(userId)) ?? UserDefaults.standard.string(forKey: tokenFallbackKey(userId))
    }

    /// Non-secret account metadata, persisted as JSON. Tokens are looked up
    /// separately from the Keychain so they never touch UserDefaults as JSON.
    private struct AccountMeta: Codable {
        let serverURL: URL
        let userId: String
        let userName: String?
    }

    private func persistAccounts() {
        let metas = savedAccounts.map { AccountMeta(serverURL: $0.serverURL, userId: $0.userId, userName: $0.userName) }
        if let data = try? JSONEncoder().encode(metas) {
            UserDefaults.standard.set(data, forKey: Self.accountsDefault)
        }
    }

    private static func hydrateAccounts() -> [Session] {
        guard let data = UserDefaults.standard.data(forKey: accountsDefault),
              let metas = try? JSONDecoder().decode([AccountMeta].self, from: data)
        else { return [] }
        return metas.compactMap { meta in
            guard let token = token(for: meta.userId) else { return nil }
            return Session(serverURL: meta.serverURL, token: token, userId: meta.userId, userName: meta.userName)
        }
    }

    private static func hydrateActive(from accounts: [Session]) -> Session? {
        guard let activeId = UserDefaults.standard.string(forKey: userIdKey) else {
            return accounts.first
        }
        return accounts.first(where: { $0.userId == activeId }) ?? accounts.first
    }

    /// One-time migration from the pre-profiles single-account layout: a token
    /// under `strata.accessToken` plus userId/serverURL in UserDefaults.
    private static func migrateLegacyIfNeeded() {
        let defaults = UserDefaults.standard
        guard defaults.data(forKey: accountsDefault) == nil else { return }
        let legacyToken = Keychain.get(legacyTokenKey) ?? defaults.string(forKey: legacyTokenFallbackKey)
        guard
            let legacyToken,
            let userId = defaults.string(forKey: userIdKey),
            let urlString = defaults.string(forKey: serverURLDefault),
            let url = URL(string: urlString)
        else { return }
        let name = defaults.string(forKey: userNameDefault)
        let meta = AccountMeta(serverURL: url, userId: userId, userName: name)
        if let data = try? JSONEncoder().encode([meta]) {
            defaults.set(data, forKey: accountsDefault)
        }
        // Re-key the token under the per-account scheme and drop the legacy copy.
        _ = Keychain.set(legacyToken, for: tokenKey(userId))
        defaults.set(legacyToken, forKey: tokenFallbackKey(userId))
        Keychain.set(nil, for: legacyTokenKey)
        defaults.removeObject(forKey: legacyTokenFallbackKey)
        Log.auth.info("Migrated legacy session to multi-account store for user=\(userId, privacy: .public)")
    }

    public static var lastServerURL: String? {
        UserDefaults.standard.string(forKey: serverURLDefault)
    }
}
