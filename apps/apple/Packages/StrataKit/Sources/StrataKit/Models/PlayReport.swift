import Foundation

/// What went wrong with a play, for the household's admins (`StrataClient.reportPlay`):
/// each copy tried, the file servers that didn't answer, and the errors as this device saw them.
public struct PlayReport: Encodable, Sendable, Equatable {
    public enum Outcome: String, Encodable, Sendable {
        /// Nothing played.
        case failed
        /// It played, after switching copies or file servers.
        case recovered
    }

    /// A file server a copy's link pointed at that didn't answer.
    public struct Server: Encodable, Sendable, Equatable {
        public var host: String
        public var error: String
        public init(host: String, error: String) {
            self.host = host
            self.error = error
        }
    }

    /// One copy tried.
    public struct Attempt: Encodable, Sendable, Equatable {
        public var fileId: Int?
        /// How the app names it ("2160p · REMUX").
        public var copy: String?
        /// "reading", "connecting", "playing"…
        public var stage: String?
        /// Nil when the copy played.
        public var error: String?
        public var servers: [Server]

        public init(fileId: Int? = nil, copy: String? = nil, stage: String? = nil, error: String? = nil, servers: [Server] = []) {
            self.fileId = fileId
            self.copy = copy
            self.stage = stage
            self.error = error
            self.servers = servers
        }
    }

    public var outcome: Outcome
    /// What the app showed (or, when it played, a line saying what it got past).
    public var message: String
    public var attempts: [Attempt]
    public var appVersion: String?

    public init(outcome: Outcome, message: String, attempts: [Attempt], appVersion: String? = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) {
        self.outcome = outcome
        self.message = message
        self.attempts = attempts
        self.appVersion = appVersion
    }
}
