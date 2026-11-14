import Foundation
import Network

/// A tiny HTTP/1.1 server for AVPlayer, on 127.0.0.1 (or, for AirPlay, every interface):
/// GET requests, answered by `handler`. Connections are kept alive.
final class LoopbackServer: @unchecked Sendable {
    enum Reply: Sendable {
        /// A body and its content type.
        case ok(Data, String)
        case notFound
        /// Not now (a segment dropped for a newer request, or a failed read): the player
        /// asks again.
        case unavailable
    }

    typealias Handler = @Sendable (String) async -> Reply

    /// A request head bigger than this isn't AVPlayer's: the connection is dropped.
    static let maxHeadBytes = 16 << 10
    /// A kept-alive connection with no request for this long is closed.
    static let idleTimeout: TimeInterval = 60

    private let listener: NWListener
    private let queue = DispatchQueue(label: "strata.remux.http")
    private let handler: Handler
    private(set) var port: UInt16 = 0
    /// Open connections and their idle timers (on `queue`), so `stop()` can close them.
    private var connections: [ObjectIdentifier: (NWConnection, DispatchWorkItem?)] = [:]
    private let lock = NSLock()
    private var stopped = false
    private var ready = false
    /// Called (on the server's queue) when the listener fails after it started: the system
    /// can take it down while the app is suspended. Not called after `stop()`.
    var onFailure: (@Sendable () -> Void)?

    /// `loopbackOnly: false` listens on every interface, so another device (an Apple TV
    /// on AirPlay) can reach it.
    init(loopbackOnly: Bool = true, handler: @escaping Handler) throws {
        self.handler = handler
        let params = NWParameters.tcp
        if loopbackOnly { params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any) }
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)
    }

    /// Listening and not stopped.
    var isListening: Bool {
        lock.withLock { ready && !stopped }
    }

    private var isStopped: Bool { lock.withLock { stopped } }

    /// Starts listening; returns once the port is known.
    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
            let resumed = Once()
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    let port = self?.listener.port?.rawValue ?? 0
                    self?.port = port
                    self?.lock.withLock { self?.ready = true }
                    resumed.run { continuation.resume(returning: port) }
                case .failed(let error):
                    var first = false
                    resumed.run { first = true; continuation.resume(throwing: error) }
                    guard let self else { return }
                    let wasReady = self.lock.withLock { () -> Bool in
                        let was = self.ready
                        self.ready = false
                        return was && !self.stopped
                    }
                    // Failed while serving: whoever owns it starts over on a new one.
                    if !first, wasReady {
                        remuxLog("loopback server failed: \(error)")
                        self.onFailure?()
                    }
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
            listener.start(queue: queue)
        }
    }

    /// Stops listening and closes every open connection (a request being answered gets nothing).
    func stop() {
        lock.withLock { stopped = true }
        listener.cancel()
        queue.async { [self] in
            let open = connections
            connections = [:]
            for (connection, timer) in open.values {
                timer?.cancel()
                connection.cancel()
            }
        }
    }

    private func serve(_ connection: NWConnection) {
        guard !isStopped else { connection.cancel(); return }
        let id = ObjectIdentifier(connection)
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.forget(id)
            default: break
            }
        }
        connections[id] = (connection, nil)
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    /// Drops a closed connection (on `queue`).
    private func forget(_ id: ObjectIdentifier) {
        connections.removeValue(forKey: id)?.1?.cancel()
    }

    /// Closes the connection if no request comes within `idleTimeout` (on `queue`).
    private func armIdleTimer(_ connection: NWConnection) {
        let id = ObjectIdentifier(connection)
        guard connections[id] != nil else { return }
        connections[id]?.1?.cancel()
        let timer = DispatchWorkItem { [weak connection] in connection?.cancel() }
        connections[id]?.1 = timer
        queue.asyncAfter(deadline: .now() + Self.idleTimeout, execute: timer)
    }

    private func disarmIdleTimer(_ connection: NWConnection) {
        let id = ObjectIdentifier(connection)
        connections[id]?.1?.cancel()
        connections[id]?.1 = nil
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        armIdleTimer(connection)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 << 10) { [weak self] data, _, complete, error in
            guard let self else { return }
            guard !self.isStopped else { connection.cancel(); return }
            var pending = buffer
            if let data { pending.append(data) }
            if let end = pending.range(of: Data("\r\n\r\n".utf8)), end.lowerBound <= Self.maxHeadBytes {
                self.disarmIdleTimer(connection)
                let head = String(decoding: pending[..<end.lowerBound], as: UTF8.self)
                let rest = pending[end.upperBound...]
                self.respond(to: head, on: connection) { keepAlive in
                    if keepAlive { self.receive(on: connection, buffer: Data(rest)) } else { connection.cancel() }
                }
            } else if complete || error != nil || pending.count > Self.maxHeadBytes {
                connection.cancel()
            } else {
                self.receive(on: connection, buffer: pending)
            }
        }
    }

    private func respond(to head: String, on connection: NWConnection, then: @escaping @Sendable (Bool) -> Void) {
        let lines = head.split(separator: "\r\n")
        let parts = lines.first?.split(separator: " ") ?? []
        let method = parts.first.map(String.init) ?? ""
        let path = parts.count > 1 ? String(parts[1]) : "/"
        let keepAlive = !lines.contains { $0.lowercased() == "connection: close" }
        let range = lines.first { $0.lowercased().hasPrefix("range:") }.map { String($0.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
        let handler = handler
        Task {
            var status = "404 Not Found"
            var body = Data()
            var type = "text/plain"
            var extra = ""
            let reply: Reply = method == "GET" || method == "HEAD" ? await handler(path) : .notFound
            guard !self.isStopped else { connection.cancel(); return }
            if case .unavailable = reply {
                status = "503 Service Unavailable"
                extra = "Retry-After: 1\r\n"
            }
            if case .ok(let data, let contentType) = reply {
                status = "200 OK"
                body = data
                type = contentType
                // AVPlayer sometimes asks for a byte range of a segment.
                if let range, let (from, to) = Self.parse(range: range, size: data.count) {
                    status = "206 Partial Content"
                    // A slice shares the segment's bytes: nothing is copied.
                    body = data[(data.startIndex + from)...(data.startIndex + to)]
                    extra = "Content-Range: bytes \(from)-\(to)/\(data.count)\r\n"
                }
            }
            let header = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n\(extra)Accept-Ranges: bytes\r\nCache-Control: no-cache\r\nConnection: \(keepAlive ? "keep-alive" : "close")\r\n\r\n"
            // Header and body go as two sends, so the segment isn't copied into one buffer.
            let done = NWConnection.SendCompletion.contentProcessed { error in then(keepAlive && error == nil) }
            if method == "HEAD" || body.isEmpty {
                connection.send(content: Data(header.utf8), completion: done)
            } else {
                connection.send(content: Data(header.utf8), completion: .idempotent)
                connection.send(content: body, completion: done)
            }
        }
    }

    static func parse(range: String, size: Int) -> (Int, Int)? {
        guard range.hasPrefix("bytes=") else { return nil }
        let spec = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard spec.count == 2 else { return nil }
        if let from = Int(spec[0]) {
            let to = Int(spec[1]).map { min($0, size - 1) } ?? size - 1
            return from <= to ? (from, to) : nil
        }
        if let suffix = Int(spec[1]), suffix > 0 { return (max(0, size - suffix), size - 1) }
        return nil
    }
}

/// Runs a closure at most once (a continuation must not resume twice).
final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func run(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard !done else { return }
        done = true
        body()
    }
}
