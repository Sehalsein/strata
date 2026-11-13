import Foundation
import Network
import Observation
import Security

/// Signing a TV in from a phone without typing the server on either: the TV shows a QR
/// code (`strata://tv-link?key=…`) and waits on the local network (`_strata-tv._tcp`).
/// The phone that scans it finds the TV, shows it saw the code (the key), and hands over
/// the addresses of the server it's signed in to. The TV gets a sign-in code from that
/// server and sends it back, and the phone approves it as it would the TV's own QR code.
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
        var key: String
        /// The server's addresses, best first.
        var addresses: [String]
    }

    /// TV → phone: one line of JSON.
    struct Answer: Codable {
        var userCode: String?
        var error: String?
        /// The phone reached a TV showing another code.
        var wrongKey: Bool?
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
            return TVLink.Answer(error: "That wasn't a Strata request.")
        }
        guard offer.key == key else { return TVLink.Answer(wrongKey: true) }
        guard !busy, let onOffer else { return TVLink.Answer(error: "This TV is already signing in.") }
        busy = true
        defer { busy = false }
        do {
            return TVLink.Answer(userCode: try await onOffer(offer.addresses))
        } catch {
            return TVLink.Answer(error: StrataError.wrap(error).message)
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
        let search = Search(offer: TVLink.Offer(key: key, addresses: addresses.map(\.absoluteString)), endpoints: endpoints)
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
        private let queue = DispatchQueue(label: "strata.tvlink.search")
        private var browser: NWBrowser?
        private var tried = Set<NWEndpoint>()
        private var connections: [NWConnection] = []
        private var continuation: CheckedContinuation<String, Error>?
        private let endpoints: [NWEndpoint]?

        init(offer: TVLink.Offer, endpoints: [NWEndpoint]?) {
            self.offer = offer
            self.endpoints = endpoints
        }

        func begin(_ continuation: CheckedContinuation<String, Error>, timeout: TimeInterval) {
            queue.async {
                self.continuation = continuation
                self.queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
                    self?.finish(.failure(StrataError(kind: .network,
                        message: "Couldn't find your TV. Make sure it's on the same Wi-Fi as this phone and still showing the code.")))
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
                        self?.finish(.failure(StrataError(kind: .network, message: "Allow Local Network access for Strata in Settings so it can find your TV.")))
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
