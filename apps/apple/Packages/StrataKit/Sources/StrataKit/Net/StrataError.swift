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
    }

    public var kind: Kind
    /// HTTP status for `.http`.
    public var status: Int?
    public var message: String

    public init(kind: Kind, status: Int? = nil, message: String) {
        self.kind = kind
        self.status = status
        self.message = message
    }

    public var errorDescription: String? { message }

    /// Worth trying another address for the same server.
    public var isConnectivity: Bool { kind == .network }
    /// The token is no longer valid; the user must sign in again.
    public var isUnauthorized: Bool { status == 401 }
    /// 409 "Select a profile first".
    public var needsProfile: Bool { status == 409 && message.localizedCaseInsensitiveContains("profile") }
    public var isNotFound: Bool { status == 404 }

    static func http(_ status: Int, serverMessage: String?) -> StrataError {
        let msg = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let msg, !msg.isEmpty {
            return StrataError(kind: .http, status: status, message: msg)
        }
        let fallback: String
        switch status {
        case 401: fallback = "Your session has expired. Sign in again."
        case 403: fallback = "You don't have access to that."
        case 404: fallback = "Not found."
        case 409: fallback = "That conflicts with the server's current state."
        case 500...599: fallback = "The server ran into a problem (\(status))."
        default: fallback = "Request failed (\(status))."
        }
        return StrataError(kind: .http, status: status, message: fallback)
    }

    /// Maps any thrown error to a `StrataError` with a friendly message.
    public static func wrap(_ error: Error, host: String? = nil) -> StrataError {
        if let e = error as? StrataError { return e }
        if error is CancellationError { return StrataError(kind: .cancelled, message: "Cancelled.") }
        if let url = error as? URLError { return network(url, host: host) }
        if error is DecodingError {
            return StrataError(kind: .decoding, message: "The server sent a response this app doesn't understand. Is the app up to date?")
        }
        return StrataError(kind: .network, message: error.localizedDescription)
    }

    static func network(_ error: URLError, host: String?) -> StrataError {
        let at = host.map { " at \($0)" } ?? ""
        let message: String
        switch error.code {
        case .cancelled:
            return StrataError(kind: .cancelled, message: "Cancelled.")
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff:
            message = "You're offline. Check your network connection."
        case .cannotConnectToHost:
            message = "Can't connect to the server\(at). Make sure Strata is running and the address is right."
        case .cannotFindHost, .dnsLookupFailed:
            message = "Can't find the server\(at). Check the address."
        case .timedOut:
            message = "The server\(at) took too long to respond."
        case .networkConnectionLost:
            message = "The connection to the server was lost. Try again."
        case .appTransportSecurityRequiresSecureConnection:
            message = "This address needs HTTPS, or the app must allow local HTTP connections."
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected:
            message = "Couldn't establish a secure connection to the server\(at)."
        case .badURL, .unsupportedURL:
            return StrataError(kind: .invalidInput, message: "That doesn't look like a valid server address.")
        default:
            message = "Couldn't reach the server\(at). (\(error.localizedDescription))"
        }
        return StrataError(kind: .network, message: message)
    }
}
