import Foundation
import Network

/// A tiny HTTP/1.1 server on 127.0.0.1 for AVPlayer: GET requests, answered by `handler`
/// with a body and content type, or nil for 404. Connections are kept alive.
final class LoopbackServer: @unchecked Sendable {
    typealias Handler = @Sendable (String) async -> (Data, String)?

    private let listener: NWListener
    private let queue = DispatchQueue(label: "strata.remux.http")
    private let handler: Handler
    private(set) var port: UInt16 = 0

    init(handler: @escaping Handler) throws {
        self.handler = handler
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)
    }

    /// Starts listening; returns once the port is known.
    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
            let resumed = Once()
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    let port = self?.listener.port?.rawValue ?? 0
                    self?.port = port
                    resumed.run { continuation.resume(returning: port) }
                case .failed(let error):
                    resumed.run { continuation.resume(throwing: error) }
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
            listener.start(queue: queue)
        }
    }

    func stop() {
        listener.cancel()
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 << 10) { [weak self] data, _, complete, error in
            guard let self else { return }
            var pending = buffer
            if let data { pending.append(data) }
            if let end = pending.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: pending[..<end.lowerBound], as: UTF8.self)
                let rest = pending[end.upperBound...]
                self.respond(to: head, on: connection) { keepAlive in
                    if keepAlive { self.receive(on: connection, buffer: Data(rest)) } else { connection.cancel() }
                }
            } else if complete || error != nil {
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
            if method == "GET" || method == "HEAD", let (data, contentType) = await handler(path) {
                status = "200 OK"
                body = data
                type = contentType
                // AVPlayer sometimes asks for a byte range of a segment.
                if let range, let (from, to) = Self.parse(range: range, size: data.count) {
                    status = "206 Partial Content"
                    body = data.subdata(in: from..<(to + 1))
                    extra = "Content-Range: bytes \(from)-\(to)/\(data.count)\r\n"
                }
            }
            let header = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n\(extra)Accept-Ranges: bytes\r\nCache-Control: no-cache\r\nConnection: \(keepAlive ? "keep-alive" : "close")\r\n\r\n"
            var response = Data(header.utf8)
            if method != "HEAD" { response.append(body) }
            connection.send(content: response, completion: .contentProcessed { _ in then(keepAlive) })
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
