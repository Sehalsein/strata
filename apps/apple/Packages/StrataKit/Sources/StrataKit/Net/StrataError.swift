import Foundation

/// Every failure from `StrataClient` / `ServerStore`, with a message fit to show the user.
public struct StrataError: Error, LocalizedError, Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// The server answered with a non-2xx status (`status` is set).
        case http
        /// Couldn't reach the server (offline, wrong address, timeout, ATS…).
        case network
        /// The response wasn't what the client expected.
        case decoding
        /// The address answered but isn't a Strata server.
        case notStrata
        /// Server speaks a different API version.
        case incompatible
        /// Bad input on our side (e.g. an empty or malformed address).
        case invalidInput
        case cancelled
        /// `CachePolicy.cachedOnly` found nothing kept on this device.
        case notCached
    }

    public var kind: Kind
    /// HTTP status for `.http`.
    public var status: Int?
    public var message: String
    /// The server's machine-readable code when it sent one (Better Auth's `code`, e.g.
    /// "INVALID_USERNAME_OR_PASSWORD", or an OAuth `error` like "expired_token").
    public var code: String?
    /// Nothing answered at the address (connection refused), as opposed to something that
    /// answered badly (a certificate, a timeout, an HTTP error).
    public var nothingListening = false

    public init(kind: Kind, status: Int? = nil, message: String, code: String? = nil) {
        self.kind = kind
        self.status = status
        self.message = message
        self.code = code
    }

    public var errorDescription: String? { message }

    /// Worth trying another address for the same server.
    public var isConnectivity: Bool { kind == .network }
    /// The token is no longer valid; the user must sign in again.
    public var isUnauthorized: Bool { status == 401 }
    /// 409 "Choose a household first": this sign-in has no active household yet.
    public var needsHousehold: Bool { status == 409 && message.localizedCaseInsensitiveContains("household") }
    /// 429: too many attempts (sign-in is rate-limited).
    public var isRateLimited: Bool { status == 429 }
    public var isNotFound: Bool { status == 404 }
    /// A request this server doesn't answer: one from before it existed (404), or one a
    /// gateway in front of it refuses (403, like the public demo's). Only for requests that
    /// have an older way to ask; elsewhere 403 means "not for this account".
    public var isUnsupportedHere: Bool { status == 404 || status == 403 }

    static func http(_ status: Int, serverMessage: String?, code: String? = nil) -> StrataError {
        let msg = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let msg, !msg.isEmpty {
            return StrataError(kind: .http, status: status, message: msg, code: code)
        }
        let fallback: String
        switch status {
        case 401: fallback = String(localized: "Your session has expired. Sign in again.", bundle: .module)
        case 403: fallback = String(localized: "You don't have access to that.", bundle: .module)
        case 404: fallback = String(localized: "Not found.", bundle: .module)
        case 409: fallback = String(localized: "That conflicts with the server's current state.", bundle: .module)
        case 429: fallback = String(localized: "Too many attempts. Wait a few minutes and try again.", bundle: .module)
        case 500...599: fallback = String(localized: "The server ran into a problem (\(status)).", bundle: .module)
        default: fallback = String(localized: "Request failed (\(status)).", bundle: .module)
        }
        return StrataError(kind: .http, status: status, message: fallback, code: code)
    }

    /// Maps any thrown error to a `StrataError` with a friendly message.
    public static func wrap(_ error: Error, host: String? = nil) -> StrataError {
        if let e = error as? StrataError { return e }
        if error is CancellationError { return StrataError(kind: .cancelled, message: String(localized: "Cancelled.", bundle: .module)) }
        if let url = error as? URLError { return network(url, host: host) }
        if error is DecodingError {
            return StrataError(kind: .decoding, message: String(localized: "The server sent a response this app doesn't understand. Is the app up to date?", bundle: .module))
        }
        return StrataError(kind: .network, message: error.localizedDescription)
    }

    static func network(_ error: URLError, host: String?) -> StrataError {
        let at = host.map { String(localized: " at \($0)", bundle: .module) } ?? ""
        let message: String
        switch error.code {
        case .cancelled:
            return StrataError(kind: .cancelled, message: String(localized: "Cancelled.", bundle: .module))
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff:
            message = String(localized: "You're offline. Check your network connection.", bundle: .module)
        case .cannotConnectToHost:
            message = String(localized: "Can't connect to the server\(at). Make sure Strata is running and the address is right.", bundle: .module)
        case .cannotFindHost, .dnsLookupFailed:
            message = String(localized: "Can't find the server\(at). Check the address.", bundle: .module)
        case .timedOut:
            message = String(localized: "The server\(at) took too long to respond.", bundle: .module)
        case .networkConnectionLost:
            message = String(localized: "The connection to the server was lost. Try again.", bundle: .module)
        case .appTransportSecurityRequiresSecureConnection:
            message = String(localized: "This address needs HTTPS, or the app must allow local HTTP connections.", bundle: .module)
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected:
            message = String(localized: "Couldn't establish a secure connection to the server\(at).", bundle: .module)
        case .badURL, .unsupportedURL:
            return StrataError(kind: .invalidInput, message: String(localized: "That doesn't look like a valid server address.", bundle: .module))
        default:
            message = String(localized: "Couldn't reach the server\(at). (\(error.localizedDescription))", bundle: .module)
        }
        var failure = StrataError(kind: .network, message: message)
        failure.nothingListening = error.code == .cannotConnectToHost
        return failure
    }
}
