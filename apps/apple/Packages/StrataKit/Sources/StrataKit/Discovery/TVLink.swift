import CryptoKit
import Foundation
import Network
import Observation
import Security

/// Signing a TV in from a phone without typing the server on either: the TV shows a QR
/// code (`strata://tv-link?key=…`) and waits on the local network (`_strata-tv._tcp`).
/// The phone that scans it finds the TV and hands over the addresses of the server it's
/// signed in to. The TV gets a sign-in code from that server and sends it back, and the
/// phone approves it as it would the TV's own QR code.
///
/// The key never crosses the network: anything on it can advertise a "TV", so the phone
/// sends a fresh challenge with a proof that it has the key (an HMAC over the challenge
/// and the addresses), and accepts only an answer the TV signs the same way. A device that
/// didn't see the QR code can neither take the offer nor answer it.
///
/// Both sides need `_strata-tv._tcp` in `NSBonjourServices`.
public enum TVLink {
    public static let serviceType = "_strata-tv._tcp"

    /// What the TV's QR code holds.
    public static func url(key: String) -> URL {
        var parts = URLComponents()
        parts.scheme = "strata"
        parts.host = "tv-link"
        parts.queryItems = [URLQueryItem(name: "key", value: key)]
        return parts.url!
    }

    /// The key in a TV's QR code, if `url` is one.
    public static func key(in url: URL) -> String? {
        guard url.scheme?.lowercased() == "strata", url.host == "tv-link" else { return nil }
        let key = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "key" }?.value
        return key.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// 20 random letters and digits.
    static func newKey() -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        var bytes = [UInt8](repeating: 0, count: 20)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return String(bytes.map { alphabet[Int($0) % alphabet.count] })
    }

    /// Phone → TV: one line of JSON.
    struct Offer: Codable {
        /// Random, new for each search.
        var challenge: String
        /// The server's addresses, best first.
        var addresses: [String]
        /// `proof(key, "offer", challenge, addresses…)`.
        var proof: String
    }

    /// TV → phone: one line of JSON.
    struct Answer: Codable {
        var userCode: String?
        var error: String?
        /// `proof(key, "answer", challenge, userCode or error)`: the phone ignores answers
        /// without it.
        var proof: String?
        /// The phone reached a TV showing another code.
        var wrongKey: Bool?
    }

    /// HMAC-SHA256 under the key of its parts (each length-prefixed, so they can't run
    /// together), as hex.
    static func proof(_ key: String, _ parts: [String]) -> String {
        var message = Data()
        for part in parts {
            let bytes = Data(part.utf8)
            message.append(contentsOf: withUnsafeBytes(of: UInt32(bytes.count).bigEndian, Array.init))
            message.append(bytes)
        }
        let mac = HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: Data(key.utf8)))
        return Data(mac).map { String(format: "%02x", $0) }.joined()
    }

    /// What an answer's proof covers: the challenge, and which it carries (a code or an error)
    /// with its text.
    static func answerParts(_ challenge: String, code: String?, error: String?) -> [String] {
        ["answer", challenge, code != nil ? "code" : "error", code ?? error ?? ""]
    }

    /// Compares two proofs in constant time.
    static func same(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        return zip(x, y).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
    }

    static func newChallenge() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Reads up to the first newline (at most 16 KB).
    static func readLine(_ connection: NWConnection, buffer: Data = Data(), done: @escaping (Data?) -> Void) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, isComplete, error in
            var buffer = buffer
            if let data { buffer.append(data) }
            if let newline = buffer.firstIndex(of: 0x0A) { return done(buffer[..<newline]) }
            if error != nil || isComplete || buffer.count > 16_384 { return done(nil) }
            readLine(connection, buffer: buffer, done: done)
        }
    }

    static func line<T: Encodable>(_ value: T) -> Data {
        var data = (try? JSONEncoder().encode(value)) ?? Data()
        data.append(0x0A)
        return data
    }
}

/// TV side: advertises this TV while its QR code shows, and answers the phone that scans it.
@MainActor
@Observable
public final class TVLinkHost {
    public let key = TVLink.newKey()
    /// The listener couldn't start (Local Network access refused, say).
    public private(set) var failure: String?
    /// Given the addresses a phone sent, returns the sign-in code to send back, or throws
    /// with a message for the phone.
    public var onOffer: (@MainActor ([String]) async throws -> String)?

    private var listener: NWListener?
    private var busy = false
    private let queue = DispatchQueue(label: "strata.tvlink")

    public init() {}

    public func start() {
        guard listener == nil else { return }
        do {
            let listener = try NWListener(using: .tcp)
            // The name only tells TVs apart; the key, which only the QR code shows, is the secret.
            listener.service = NWListener.Service(name: "Strata TV \(key.prefix(4))", type: TVLink.serviceType)
            listener.stateUpdateHandler = { [weak self] state in
                if case .failed(let error) = state {
                    Task { @MainActor in self?.failure = error.localizedDescription }
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                Task { @MainActor in self?.accept(connection) }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            failure = error.localizedDescription
        }
    }

    public func stop() {
        listener?.cancel()
        listener = nil
    }

    /// The port it listens on, once started (tests connect to it directly).
    var port: UInt16? { listener?.port.flatMap { $0.rawValue == 0 ? nil : $0.rawValue } }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        TVLink.readLine(connection) { [weak self] data in
            Task { @MainActor in
                guard let self else { return connection.cancel() }
                let answer = await self.answer(data)
                connection.send(content: TVLink.line(answer), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
    }

    private func answer(_ data: Data?) async -> TVLink.Answer {
        guard let data, let offer = try? JSONDecoder().decode(TVLink.Offer.self, from: data) else {
            return TVLink.Answer(error: String(localized: "That wasn't a Strata request.", bundle: .module))
        }
        guard TVLink.same(offer.proof, TVLink.proof(key, ["offer", offer.challenge] + offer.addresses)) else { return TVLink.Answer(wrongKey: true) }
        let signed = { (code: String?, error: String?) in
            TVLink.Answer(userCode: code, error: error, proof: TVLink.proof(self.key, TVLink.answerParts(offer.challenge, code: code, error: error)))
        }
        guard !busy, let onOffer else { return signed(nil, String(localized: "This TV is already signing in.", bundle: .module)) }
        busy = true
        defer { busy = false }
        do {
            return signed(try await onOffer(offer.addresses), nil)
        } catch {
            return signed(nil, StrataError.wrap(error).message)
        }
    }
}

/// Phone side: finds the TV showing a code and hands it the server.
public enum TVLinkClient {
    /// Finds the TV whose QR code held `key`, sends it the server's addresses, and returns
    /// the sign-in code the TV got from that server.
    public static func link(key: String, addresses: [URL], timeout: TimeInterval = 20) async throws -> String {
        try await link(key: key, addresses: addresses, timeout: timeout, endpoints: nil)
    }

    /// `endpoints` replaces the search on the network (tests).
    static func link(key: String, addresses: [URL], timeout: TimeInterval, endpoints: [NWEndpoint]?) async throws -> String {
        let challenge = TVLink.newChallenge()
        let sent = addresses.map(\.absoluteString)
        let offer = TVLink.Offer(challenge: challenge, addresses: sent, proof: TVLink.proof(key, ["offer", challenge] + sent))
        let search = Search(offer: offer, key: key, endpoints: endpoints)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                search.begin(continuation, timeout: timeout)
            }
        } onCancel: {
            search.finish(.failure(CancellationError()))
        }
    }

    /// Browses for TVs and tries each until one takes the key.
    private final class Search: @unchecked Sendable {
        private let offer: TVLink.Offer
        private let key: String
        private let queue = DispatchQueue(label: "strata.tvlink.search")
        private var browser: NWBrowser?
        private var tried = Set<NWEndpoint>()
        private var connections: [NWConnection] = []
        private var continuation: CheckedContinuation<String, Error>?
        private let endpoints: [NWEndpoint]?

        init(offer: TVLink.Offer, key: String, endpoints: [NWEndpoint]?) {
            self.offer = offer
            self.key = key
            self.endpoints = endpoints
        }

        func begin(_ continuation: CheckedContinuation<String, Error>, timeout: TimeInterval) {
            queue.async {
                self.continuation = continuation
                self.queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
                    self?.finish(.failure(StrataError(kind: .network,
                        message: String(localized: "Couldn't find your TV. Make sure it's on the same Wi-Fi as this phone and still showing the code.", bundle: .module))))
                }
                if let endpoints = self.endpoints { return endpoints.forEach(self.attempt) }
                let params = NWParameters()
                params.includePeerToPeer = false
                let browser = NWBrowser(for: .bonjour(type: TVLink.serviceType, domain: "local."), using: params)
                browser.browseResultsChangedHandler = { [weak self] results, _ in
                    guard let self else { return }
                    for result in results where !self.tried.contains(result.endpoint) {
                        self.tried.insert(result.endpoint)
                        self.attempt(result.endpoint)
                    }
                }
                browser.stateUpdateHandler = { [weak self] state in
                    if case .failed(let error) = state { self?.finish(.failure(StrataError(kind: .network, message: error.localizedDescription))) }
                    if case .waiting(let error) = state, case .dns(let code) = error, code == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) {
                        self?.finish(.failure(StrataError(kind: .network, message: String(localized: "Allow Local Network access for Strata in Settings so it can find your TV.", bundle: .module))))
                    }
                }
                browser.start(queue: self.queue)
                self.browser = browser
            }
        }

        private func attempt(_ endpoint: NWEndpoint) {
            let connection = NWConnection(to: endpoint, using: .tcp)
            connections.append(connection)
            connection.start(queue: queue)
            connection.send(content: TVLink.line(offer), completion: .contentProcessed { _ in })
            TVLink.readLine(connection) { [weak self] data in
                connection.cancel()
                guard let self, let data, let answer = try? JSONDecoder().decode(TVLink.Answer.self, from: data) else { return }
                // Only the TV that showed the code can sign its answer; anything else that
                // answers (a device pretending to be a TV) is ignored.
                guard answer.wrongKey != true, let proof = answer.proof, (answer.userCode == nil) != (answer.error == nil),
                      TVLink.same(proof, TVLink.proof(self.key, TVLink.answerParts(self.offer.challenge, code: answer.userCode, error: answer.error))),
                      answer.userCode.map({ $0.range(of: "^[A-Z0-9-]{4,16}$", options: .regularExpression) != nil }) ?? true else { return }
                if let code = answer.userCode {
                    self.finish(.success(code))
                } else if answer.wrongKey != true, let error = answer.error {
                    // The TV took the key but couldn't sign in.
                    self.finish(.failure(StrataError(kind: .network, message: error)))
                }
            }
        }

        /// Ends the search once (later calls do nothing).
        func finish(_ result: Result<String, Error>) {
            queue.async {
                guard let continuation = self.continuation else { return }
                self.continuation = nil
                self.browser?.cancel()
                self.connections.forEach { $0.cancel() }
                continuation.resume(with: result)
            }
        }
    }
}
