import Foundation
import Observation
import os

public struct Session: Equatable, Sendable {
    public let serverURL: URL
    public let token: String
    public let userId: String
    public let userName: String?
}

@MainActor
@Observable
public final class AuthStore {
    public private(set) var session: Session?
    public private(set) var isAuthenticating = false
    public private(set) var lastError: String?

    private static let tokenKey = "strata.accessToken"
    private static let userIdKey = "strata.userId"
    private static let userNameDefault = "strata.userName"
    private static let serverURLDefault = "strata.serverURL"
    /// Always-on UserDefaults fallback for the token. We prefer Keychain when
    /// it's available, but on simulator builds without code-signed
    /// entitlements the Keychain rejects writes with `errSecMissingEntitlement`.
    /// For a personal self-hosted client, falling back to UserDefaults keeps
    /// "stay signed in" working in dev.
    private static let tokenFallbackDefault = "strata.accessToken.fallback"

    public init() {
        self.session = Self.hydrate()
        if let s = session {
            Log.auth.info("Session hydrated for user=\(s.userId, privacy: .public)")
        } else {
            Log.auth.info("Session NOT hydrated: \(Self.hydrateFailureReason(), privacy: .public)")
        }
    }

    public var client: JellyfinClient? {
        session.map { JellyfinClient(session: $0) }
    }

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
            persist(session: s)
            self.session = s
            Log.auth.info("signIn ok user=\(s.userId, privacy: .public)")
        } catch {
            let msg = (error as? JellyfinClient.RequestError)?.message ?? error.localizedDescription
            lastError = msg
            Log.auth.error("signIn failed: \(msg, privacy: .public)")
        }
    }

    public func signOut() {
        Keychain.set(nil, for: Self.tokenKey)
        UserDefaults.standard.removeObject(forKey: Self.userIdKey)
        UserDefaults.standard.removeObject(forKey: Self.userNameDefault)
        UserDefaults.standard.removeObject(forKey: Self.tokenFallbackDefault)
        session = nil
    }

    private func persist(session s: Session) {
        let kcStatus = Keychain.set(s.token, for: Self.tokenKey)
        UserDefaults.standard.set(s.userId, forKey: Self.userIdKey)
        UserDefaults.standard.set(s.userName, forKey: Self.userNameDefault)
        UserDefaults.standard.set(s.serverURL.absoluteString, forKey: Self.serverURLDefault)
        // Always mirror the token to UserDefaults so persistence survives
        // when Keychain is unavailable (simulator without signed entitlements,
        // corp profile restrictions, etc.). Keychain remains the primary
        // store; this is the safety net.
        UserDefaults.standard.set(s.token, forKey: Self.tokenFallbackDefault)
        if kcStatus != errSecSuccess {
            Log.auth.warning("Keychain write failed (\(kcStatus)); relying on UserDefaults fallback")
        }
    }

    private static func hydrate() -> Session? {
        let token = Keychain.get(tokenKey) ?? UserDefaults.standard.string(forKey: tokenFallbackDefault)
        guard
            let token,
            let userId = UserDefaults.standard.string(forKey: userIdKey),
            let urlString = UserDefaults.standard.string(forKey: serverURLDefault),
            let url = URL(string: urlString)
        else { return nil }
        let name = UserDefaults.standard.string(forKey: userNameDefault)
        return Session(serverURL: url, token: token, userId: userId, userName: name)
    }

    private static func hydrateFailureReason() -> String {
        var missing: [String] = []
        if Keychain.get(tokenKey) == nil,
           UserDefaults.standard.string(forKey: tokenFallbackDefault) == nil {
            missing.append("token")
        }
        if UserDefaults.standard.string(forKey: userIdKey) == nil { missing.append("userId") }
        if UserDefaults.standard.string(forKey: serverURLDefault) == nil { missing.append("serverURL") }
        return missing.isEmpty ? "URL parse failed" : "missing \(missing.joined(separator: ","))"
    }

    public static var lastServerURL: String? {
        UserDefaults.standard.string(forKey: serverURLDefault)
    }
}
