import Foundation

/// Random access to the bytes of a file, for the demuxer. Reads block: they run on the
/// session's own queue, never on the main thread or Swift's cooperative pool.
protocol ByteSource: AnyObject {
    /// Total size in bytes.
    var size: Int64 { get }
    /// Reads up to `count` bytes at `offset`; 0 at the end of the file.
    func read(at offset: Int64, into buffer: UnsafeMutableRawPointer, count: Int) throws -> Int
    func close()
}

public enum RemuxError: Error, LocalizedError, Equatable {
    case network(String)
    case linkExpired
    case unsupported(String)
    case ffmpeg(String)

    public var errorDescription: String? {
        switch self {
        case .network(let message): message
        case .linkExpired: "The link to this file expired."
        case .unsupported(let message): message
        case .ffmpeg(let message): message
        }
    }
}

/// A file on the device (downloads).
final class FileByteSource: ByteSource {
    private let handle: FileHandle
    let size: Int64

    init(url: URL) throws {
        handle = try FileHandle(forReadingFrom: url)
        size = Int64(try handle.seekToEnd())
    }

    func read(at offset: Int64, into buffer: UnsafeMutableRawPointer, count: Int) throws -> Int {
        guard offset < size else { return 0 }
        let n = pread(handle.fileDescriptor, buffer, count, off_t(offset))
        if n < 0 { throw RemuxError.ffmpeg(String(cString: strerror(errno))) }
        return n
    }

    func close() { try? handle.close() }
}

/// A file behind an HTTP(S) link (TorBox), fetched in blocks with ranged requests through
/// URLSession, so it uses the system's networking (proxies, HTTP/2, VPNs). Blocks are kept
/// in a small LRU and the next ones are fetched ahead while the player reads forward.
/// A link that stops working (401/403/404/410) is replaced once through `refresh`.
final class HTTPByteSource: ByteSource, @unchecked Sendable {
    static let blockSize = 2 << 20
    /// About 64 MB: enough read-ahead for a 4K remux without holding much of the file.
    static let maxBlocks = 32
    static let readAhead = 3

    private var url: URL
    private let refresh: (@Sendable () async throws -> URL)?
    private let session: URLSession
    private let lock = NSLock()
    private var blocks: [Int64: Data] = [:]
    private var lru: [Int64] = []
    private var inFlight: [Int64: [CheckedContinuationBox]] = [:]
    private var lastBlock: Int64 = -1
    /// Set by `close()`: no new requests (a closed URLSession throws on new tasks).
    private var closed = false
    private(set) var size: Int64 = 0
    /// Bytes fetched so far, for Stream Details.
    private(set) var bytesFetched: Int64 = 0

    init(url: URL, refresh: (@Sendable () async throws -> URL)?) throws {
        self.url = url
        self.refresh = refresh
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        config.httpMaximumConnectionsPerHost = 4
        session = URLSession(configuration: config)
        // The first block also tells us the file's size (Content-Range).
        _ = try block(0)
        if size == 0 { throw RemuxError.network("The server didn't say how big the file is.") }
    }

    func read(at offset: Int64, into buffer: UnsafeMutableRawPointer, count: Int) throws -> Int {
        guard offset < size, count > 0 else { return 0 }
        let index = offset / Int64(Self.blockSize)
        let data = try block(index)
        let start = Int(offset - index * Int64(Self.blockSize))
        let n = min(count, data.count - start)
        guard n > 0 else { return 0 }
        data.withUnsafeBytes { raw in buffer.copyMemory(from: raw.baseAddress! + start, byteCount: n) }
        prefetch(after: index)
        return n
    }

    func close() {
        lock.lock()
        closed = true
        let waiting = inFlight
        inFlight = [:]
        lock.unlock()
        session.invalidateAndCancel()
        // Anyone still waiting for a block gets an error instead of hanging.
        for waiters in waiting.values { waiters.forEach { $0.resume(.failure(RemuxError.network("Closed."))) } }
    }

    // MARK: - Blocks

    /// A block, from memory or the network (waiting for a fetch already under way).
    private func block(_ index: Int64) throws -> Data {
        lock.lock()
        if let data = blocks[index] {
            touch(index)
            lock.unlock()
            return data
        }
        let waiter = CheckedContinuationBox()
        let start = inFlight[index] == nil
        inFlight[index, default: []].append(waiter)
        lock.unlock()
        if start { fetch(index) }
        return try waiter.wait()
    }

    /// Fetches the next blocks while the reader moves forward through the file.
    private func prefetch(after index: Int64) {
        lock.lock()
        let sequential = index == lastBlock || index == lastBlock + 1
        lastBlock = index
        var wanted: [Int64] = []
        if sequential {
            for next in (index + 1)...(index + Int64(Self.readAhead)) where next * Int64(Self.blockSize) < size {
                if blocks[next] == nil && inFlight[next] == nil {
                    inFlight[next] = []
                    wanted.append(next)
                }
            }
        }
        lock.unlock()
        wanted.forEach { fetch($0) }
    }

    private func fetch(_ index: Int64, retried: Bool = false) {
        let from = index * Int64(Self.blockSize)
        let to = from + Int64(Self.blockSize) - 1
        lock.lock()
        // Started under the lock `close()` takes, so the session can't be invalidated between
        // the check and the new task (which would throw).
        defer { lock.unlock() }
        guard !closed else {
            DispatchQueue.global().async { self.finish(index, .failure(RemuxError.network("Closed."))) }
            return
        }
        var request = URLRequest(url: url)
        request.setValue("bytes=\(from)-\(size > 0 ? min(to, size - 1) : to)", forHTTPHeaderField: "Range")
        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if [401, 403, 404, 410].contains(status), !retried, let refresh = self.refresh {
                // The link expired: ask for a new one and fetch the same bytes from it.
                Task {
                    do {
                        self.setURL(try await refresh())
                        self.fetch(index, retried: true)
                    } catch {
                        self.finish(index, .failure(RemuxError.linkExpired))
                    }
                }
                return
            }
            if let error {
                self.finish(index, .failure(RemuxError.network(error.localizedDescription)))
            } else if let data, status == 206 || (status == 200 && index == 0) {
                if let range = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Range"),
                   let total = range.split(separator: "/").last.flatMap({ Int64($0) }) {
                    self.setSize(total)
                } else if status == 200 {
                    self.setSize(response?.expectedContentLength ?? Int64(data.count))
                }
                // A server that ignores Range sends the whole file: keep just this block.
                let block = status == 200 ? data.prefix(Self.blockSize) : data
                self.finish(index, .success(Data(block)))
            } else {
                self.finish(index, .failure(RemuxError.network("The file server answered \(status).")))
            }
        }.resume()
    }

    private func setURL(_ new: URL) {
        lock.lock(); url = new; lock.unlock()
    }

    private func setSize(_ total: Int64) {
        lock.lock(); if size == 0 { size = total }; lock.unlock()
    }

    private func finish(_ index: Int64, _ result: Result<Data, Error>) {
        lock.lock()
        let waiters = inFlight.removeValue(forKey: index) ?? []
        if case .success(let data) = result {
            blocks[index] = data
            bytesFetched += Int64(data.count)
            touch(index)
            while lru.count > Self.maxBlocks, let oldest = lru.first {
                lru.removeFirst()
                blocks.removeValue(forKey: oldest)
            }
        }
        lock.unlock()
        waiters.forEach { $0.resume(result) }
    }

    /// Marks a block as just used (lock held).
    private func touch(_ index: Int64) {
        lru.removeAll { $0 == index }
        lru.append(index)
    }
}

/// A one-shot wait for a block fetched on another thread.
final class CheckedContinuationBox: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)
    private var result: Result<Data, Error>?

    func resume(_ result: Result<Data, Error>) {
        self.result = result
        semaphore.signal()
    }

    func wait() throws -> Data {
        semaphore.wait()
        return try result!.get()
    }
}
