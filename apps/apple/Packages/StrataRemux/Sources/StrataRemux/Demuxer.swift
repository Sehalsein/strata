import Foundation
import FFmpeg

/// The input file: its streams, the video keyframes to cut segments at, and packet reads
/// from any point.
final class Demuxer {
    let io: IOBridge
    private(set) var format: UnsafeMutablePointer<AVFormatContext>!
    let videoIndex: Int32
    /// The stream times (in seconds) of the video's keyframes, from the file's index (MKV
    /// Cues, MP4 sample table). Empty when the file has none.
    private(set) var keyframes: [Double] = []
    let duration: Double

    init(source: ByteSource, videoIndex requested: Int32?) throws {
        io = try IOBridge(source: source)
        format = avformat_alloc_context()
        format.pointee.pb = io.context
        format.pointee.flags |= AVFMT_FLAG_CUSTOM_IO
        // Enough to read the stream headers without pulling much of a 4K file.
        format.pointee.probesize = 4 << 20
        format.pointee.max_analyze_duration = 3 * Int64(AV_TIME_BASE)
        var ctx: UnsafeMutablePointer<AVFormatContext>? = format
        let opened = avformat_open_input(&ctx, nil, nil, nil)
        if opened < 0 {
            format = nil
            throw io.takeError() ?? RemuxError.unsupported("This file can't be opened here (\(ffError(opened))).")
        }
        if avformat_find_stream_info(format, nil) < 0, let error = io.takeError() { throw error }

        let best = av_find_best_stream(format, AVMEDIA_TYPE_VIDEO, requested ?? -1, -1, nil, 0)
        guard best >= 0 else { throw RemuxError.unsupported("This file has no video.") }
        videoIndex = best
        let fileDuration = format.pointee.duration
        duration = fileDuration > 0 ? Double(fileDuration) / Double(AV_TIME_BASE) : 0
        try loadKeyframes()
    }

    deinit {
        if format != nil { avformat_close_input(&format) }
    }

    func stream(_ index: Int32) -> UnsafeMutablePointer<AVStream> {
        format.pointee.streams[Int(index)]!
    }

    var streamCount: Int32 { Int32(format.pointee.nb_streams) }

    /// Matroska reads its Cues on the first seek; the index is complete after that.
    private func loadKeyframes() throws {
        let video = stream(videoIndex)
        if avformat_index_get_entries_count(video) < 2 {
            av_seek_frame(format, videoIndex, 0, AVSEEK_FLAG_BACKWARD)
        }
        let tb = video.pointee.time_base
        let count = avformat_index_get_entries_count(video)
        var times: [Double] = []
        times.reserveCapacity(Int(count))
        for i in 0..<count {
            guard let entry = avformat_index_get_entry(video, i), entry.pointee.flags & AVINDEX_KEYFRAME != 0 else { continue }
            let ts = entry.pointee.timestamp
            if ts != AV_NOPTS { times.append(Double(ts) * tb.seconds) }
        }
        keyframes = times.sorted()
    }

    /// Positions the reader at the last video keyframe at or before `seconds`.
    func seek(to seconds: Double) throws {
        let tb = stream(videoIndex).pointee.time_base
        let ts = Int64((seconds / tb.seconds).rounded(.down))
        let result = av_seek_frame(format, videoIndex, max(0, ts), AVSEEK_FLAG_BACKWARD)
        if result < 0 {
            if let error = io.takeError() { throw error }
            try check(av_seek_frame(format, videoIndex, 0, AVSEEK_FLAG_BACKWARD), "Seeking")
        }
    }

    /// The next packet, or nil at the end of the file.
    func read(into packet: UnsafeMutablePointer<AVPacket>) throws -> Bool {
        let result = av_read_frame(format, packet)
        if result == AVERROR_EOF_CODE { return false }
        if result < 0 {
            throw io.takeError() ?? RemuxError.ffmpeg("Reading the file: \(ffError(result))")
        }
        return true
    }
}
