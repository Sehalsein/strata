import Foundation
import FFmpeg

// C macros Swift can't import.

func fourCC(_ s: StaticString) -> UInt32 {
    let p = s.utf8Start
    return UInt32(p[0]) | UInt32(p[1]) << 8 | UInt32(p[2]) << 16 | UInt32(p[3]) << 24
}

let AV_NOPTS: Int64 = Int64.min
let AVERROR_EOF_CODE: Int32 = -Int32(bitPattern: fourCC("EOF "))
let AVERROR_EAGAIN: Int32 = -EAGAIN

func ffError(_ code: Int32) -> String {
    var buffer = [CChar](repeating: 0, count: 128)
    av_strerror(code, &buffer, buffer.count)
    return String(cString: buffer)
}

@discardableResult
func check(_ code: Int32, _ what: String) throws -> Int32 {
    if code < 0 { throw RemuxError.ffmpeg("\(what): \(ffError(code))") }
    return code
}

extension AVRational {
    var seconds: Double { den == 0 ? 0 : Double(num) / Double(den) }
}

/// FFmpeg reads through a `ByteSource` with this: an AVIOContext whose read and seek
/// callbacks forward to it.
final class IOBridge {
    let source: ByteSource
    private(set) var context: UnsafeMutablePointer<AVIOContext>!
    fileprivate var position: Int64 = 0
    fileprivate var lastError: Error?

    init(source: ByteSource) throws {
        self.source = source
        let size = 256 << 10
        guard let buffer = av_malloc(size) else { throw RemuxError.ffmpeg("Out of memory") }
        let opaque = Unmanaged.passUnretained(self).toOpaque()
        guard let ctx = avio_alloc_context(buffer.assumingMemoryBound(to: UInt8.self), Int32(size), 0, opaque, ioRead, nil, ioSeek) else {
            av_free(buffer)
            throw RemuxError.ffmpeg("Couldn't open the file")
        }
        context = ctx
    }

    deinit {
        if context != nil {
            av_freep(&context.pointee.buffer)
            avio_context_free(&context)
        }
    }
}

private func ioRead(_ opaque: UnsafeMutableRawPointer?, _ buffer: UnsafeMutablePointer<UInt8>?, _ size: Int32) -> Int32 {
    let io = Unmanaged<IOBridge>.fromOpaque(opaque!).takeUnretainedValue()
    do {
        let n = try io.source.read(at: io.position, into: buffer!, count: Int(size))
        if n == 0 { return AVERROR_EOF_CODE }
        io.position += Int64(n)
        return Int32(n)
    } catch {
        io.lastError = error
        return -EIO
    }
}

private func ioSeek(_ opaque: UnsafeMutableRawPointer?, _ offset: Int64, _ whence: Int32) -> Int64 {
    let io = Unmanaged<IOBridge>.fromOpaque(opaque!).takeUnretainedValue()
    switch whence & ~AVSEEK_FORCE {
    case AVSEEK_SIZE: return io.source.size
    case SEEK_SET: io.position = offset
    case SEEK_CUR: io.position += offset
    case SEEK_END: io.position = io.source.size + offset
    default: return -1
    }
    return io.position
}

extension IOBridge {
    /// The network error behind an FFmpeg failure, when there was one.
    func takeError() -> Error? {
        defer { lastError = nil }
        return lastError
    }
}
