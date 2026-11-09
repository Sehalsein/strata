import Foundation
import FFmpeg

/// What to do with the file: which streams, and what happens to its audio.
public struct RemuxPlan: Sendable, Equatable {
    public enum Audio: String, Sendable { case copy, lossless }
    public var videoStreamIndex: Int32?
    public var audioStreamIndex: Int32?
    public var audio: Audio
    /// Dolby Vision profile 7: keep the HDR10 base layer only.
    public var stripDolbyVision: Bool
    /// "PQ" (HDR10, Dolby Vision), "HLG" or "SDR", when known from elsewhere: the file's own
    /// flag can sit in the video bitstream, which isn't decoded here.
    public var videoRange: String?

    public init(videoStreamIndex: Int32? = nil, audioStreamIndex: Int32? = nil, audio: Audio = .copy, stripDolbyVision: Bool = false, videoRange: String? = nil) {
        self.videoStreamIndex = videoStreamIndex
        self.audioStreamIndex = audioStreamIndex
        self.audio = audio
        self.stripDolbyVision = stripDolbyVision
        self.videoRange = videoRange
    }
}

/// A text subtitle line from the stream, in media seconds.
public struct SubtitleCue: Sendable, Equatable, Hashable {
    public let streamIndex: Int32
    public let start: Double
    public let end: Double
    public let text: String
}

/// Cuts the file into HLS segments at video keyframes (about every 6 s) and writes each as
/// a fragment of MP4: video copied, audio copied or made lossless. Segments are built on
/// request, in any order, so AVPlayer can seek anywhere in the file.
final class Segmenter {
    static let targetSeconds = 6.0
    /// Every track starts this much later than in the file, leaving room for video decode
    /// times to run behind presentation times (B-frames) without going below zero. Apple's
    /// player starts its timeline at the first frame, as with ffmpeg's own HLS output.
    static let timelineShift = 0.5

    let demuxer: Demuxer
    let plan: RemuxPlan
    let audioIndex: Int32?
    /// Segment start times in seconds; the last element is the end of the file.
    let boundaries: [Double]
    private let lossless: LosslessAudio?
    private let subtitles: SubtitleReader
    private var initData: Data?
    /// The media of the segment the header was built from (`firstIndex`).
    private var firstMedia: Data?
    private var firstIndex = 0
    /// Lines from the text subtitle streams, as segments are read.
    var onCues: (([SubtitleCue]) -> Void)?

    init(demuxer: Demuxer, plan: RemuxPlan) throws {
        self.demuxer = demuxer
        self.plan = plan
        var audio: Int32? = plan.audioStreamIndex
        if audio == nil {
            let best = av_find_best_stream(demuxer.format, AVMEDIA_TYPE_AUDIO, -1, demuxer.videoIndex, nil, 0)
            audio = best >= 0 ? best : nil
        }
        audioIndex = audio
        lossless = plan.audio == .lossless && audio != nil ? try LosslessAudio(stream: demuxer.stream(audio!)) : nil
        subtitles = SubtitleReader(demuxer: demuxer)
        boundaries = Self.boundaries(keyframes: demuxer.keyframes, duration: demuxer.duration)
        guard boundaries.count > 1 else { throw RemuxError.unsupported("This file has no length to play.") }
    }

    var segmentCount: Int { boundaries.count - 1 }

    func duration(of segment: Int) -> Double { boundaries[segment + 1] - boundaries[segment] }

    /// Starts at keyframes at least `targetSeconds` apart, from 0 to the end. A file without
    /// an index gets even cuts; each segment then starts at the keyframe before its cut.
    static func boundaries(keyframes: [Double], duration: Double) -> [Double] {
        let end = max(duration, keyframes.last ?? 0)
        guard end > 0 else { return [] }
        var cuts: [Double] = [0]
        if keyframes.count >= 2 {
            for k in keyframes where k - cuts.last! >= targetSeconds - 0.001 && end - k > 0.5 {
                cuts.append(k)
            }
        } else {
            var t = targetSeconds
            while t < end - 0.5 { cuts.append(t); t += targetSeconds }
        }
        cuts.append(end)
        return cuts
    }

    // MARK: - Segments

    /// The segment playing `seconds` (media time).
    func segment(at seconds: Double) -> Int {
        guard seconds > 0 else { return 0 }
        let i = (boundaries.lastIndex { $0 <= seconds + 0.001 } ?? 0)
        return min(i, segmentCount - 1)
    }

    /// ftyp + moov, describing the tracks every segment carries. Built along with segment
    /// `index` (where playback starts), whose media is kept for the player's first request.
    func initSegment(from index: Int = 0) throws -> Data {
        if let initData { return initData }
        let full = try build(segment: index)
        let boxes = MP4Boxes.split(full)
        guard !boxes.header.isEmpty else { throw RemuxError.ffmpeg("The MP4 writer produced no header.") }
        initData = boxes.header
        firstMedia = boxes.media
        firstIndex = index
        return boxes.header
    }

    /// moof + mdat for one segment. `abandon` is asked as packets are read; returning true
    /// stops the build (the player has moved elsewhere) with `RemuxError.abandoned`.
    func mediaSegment(_ index: Int, abandon: () -> Bool = { false }) throws -> Data {
        if index == firstIndex, let firstMedia { return firstMedia }
        return MP4Boxes.split(try build(segment: index, abandon: abandon)).media
    }

    /// Reads one segment's packets and writes them as a fragmented MP4 (with its own header,
    /// which callers keep or drop).
    private func build(segment index: Int, abandon: () -> Bool = { false }) throws -> Data {
        let start = boundaries[index]
        let end = boundaries[index + 1]
        let last = index == segmentCount - 1
        let video = demuxer.stream(demuxer.videoIndex)
        let vtb = video.pointee.time_base
        let audio = audioIndex.map { demuxer.stream($0) }
        let atb = audio?.pointee.time_base ?? AVRational(num: 1, den: 1)
        let eps = 0.0005

        // Lossless audio decodes from a little earlier, so it has found its sync by `start`.
        let preroll = lossless != nil && index > 0 ? 1.5 : 0
        try demuxer.seek(to: max(0, start - preroll))
        lossless?.reset()

        var videoPackets: [UnsafeMutablePointer<AVPacket>] = []
        var audioPackets: [UnsafeMutablePointer<AVPacket>] = []
        var chunks: [LosslessAudio.Chunk] = []
        defer {
            for p in videoPackets + audioPackets {
                var owned: UnsafeMutablePointer<AVPacket>? = p
                av_packet_free(&owned)
            }
        }
        var cues: [SubtitleCue] = []
        var videoStarted = false
        var videoDone = false
        var audioDone = audio == nil
        let packet = av_packet_alloc()!
        defer { var p: UnsafeMutablePointer<AVPacket>? = packet; av_packet_free(&p) }

        while !(videoDone && audioDone) {
            if abandon() { throw RemuxError.abandoned }
            guard try demuxer.read(into: packet) else { break }
            defer { av_packet_unref(packet) }
            let si = packet.pointee.stream_index
            let rawTs = packet.pointee.pts != AV_NOPTS ? packet.pointee.pts : packet.pointee.dts
            if si == demuxer.videoIndex {
                guard !videoDone, rawTs != AV_NOPTS else { continue }
                let t = Double(rawTs) * vtb.seconds
                let key = packet.pointee.flags & AV_PKT_FLAG_KEY != 0
                if !videoStarted {
                    // Decode order from the keyframe that opens this segment.
                    guard key, t >= start - 0.05 || index == 0 else { continue }
                    videoStarted = true
                } else if key && t >= end - 0.05 && !last {
                    videoDone = true
                    continue
                }
                videoPackets.append(av_packet_clone(packet))
            } else if let audio, si == audio.pointee.index {
                guard rawTs != AV_NOPTS else { continue }
                let t = Double(rawTs) * atb.seconds
                if !last && t >= end + (lossless != nil ? 0.5 : 0) - eps {
                    audioDone = true
                    continue
                }
                if let lossless {
                    if t >= start - preroll - eps { chunks += lossless.decode(packet) }
                } else if t >= start - eps || index == 0 {
                    audioPackets.append(av_packet_clone(packet))
                }
            } else if let cue = subtitles.cues(for: packet), t(of: packet) < end, t(of: packet) >= start - eps {
                cues += cue
            }
            // Keep a stuck stream from reading the rest of the file.
            if Double(rawTs == AV_NOPTS ? 0 : rawTs) * demuxer.stream(si).pointee.time_base.seconds > end + 20 {
                if si == demuxer.videoIndex { videoDone = true } else { audioDone = true }
            }
        }
        if !cues.isEmpty { onCues?(cues) }
        guard !videoPackets.isEmpty else { throw RemuxError.ffmpeg("Segment \(index) has no video.") }
        Self.assignDecodeTimes(videoPackets, reorderDelay: reorderDelay)
        // Every track moves by the same amount, so sync is kept and no decode time is
        // negative (fragments can't start before 0).
        let videoShift = av_rescale_q(Int64(Self.timelineShift * 1_000_000), AVRational(num: 1, den: 1_000_000), vtb)
        for p in videoPackets {
            p.pointee.pts += videoShift
            p.pointee.dts += videoShift
        }

        if let lossless {
            let rate = Int64(lossless.sampleRate)
            let first = Int64((start * Double(rate)).rounded())
            let stop = last ? Int64.max / 2 : Int64((end * Double(rate)).rounded())
            let encoded = try lossless.encode(chunks, from: first, to: min(stop, chunks.map { $0.firstSample + Int64($0.samples) }.max() ?? first))
            audioPackets = encoded
        }
        let audioTB = lossless.map { AVRational(num: 1, den: $0.sampleRate) } ?? atb
        let audioShift = av_rescale_q(Int64(Self.timelineShift * 1_000_000), AVRational(num: 1, den: 1_000_000), audioTB)
        for p in audioPackets {
            if p.pointee.pts != AV_NOPTS { p.pointee.pts += audioShift }
            if p.pointee.dts != AV_NOPTS { p.pointee.dts += audioShift }
        }
        return try FragmentWriter.write(
            segment: index,
            video: video,
            videoPackets: videoPackets,
            audio: audio,
            audioCodec: lossless?.encoderTemplate,
            audioPackets: audioPackets,
            stripDolbyVision: plan.stripDolbyVision
        )
    }

    /// How far decode time runs behind presentation time, in the video's time base: the
    /// B-frame reorder depth times a frame's duration. The same for every segment, so
    /// their decode timelines join up.
    private lazy var reorderDelay: Int64 = {
        let video = demuxer.stream(demuxer.videoIndex)
        let depth = Int64(max(video.pointee.codecpar.pointee.video_delay, 2))
        var rate = video.pointee.avg_frame_rate
        if rate.num == 0 { rate = video.pointee.r_frame_rate }
        let frame = rate.num == 0 ? 0 : av_rescale_q(1, AVRational(num: rate.den, den: rate.num), video.pointee.time_base)
        return depth * max(frame, 1)
    }()

    /// MKV stores only presentation times, and FFmpeg's guesses at decode times after a
    /// seek can land after them, which MP4 forbids. Decode times are the presentation
    /// times in order (they rise as packets are decoded) moved back by the reorder delay,
    /// or further if a packet would otherwise decode after it is shown.
    static func assignDecodeTimes(_ packets: [UnsafeMutablePointer<AVPacket>], reorderDelay: Int64) {
        let pts = packets.map { $0.pointee.pts }
        guard !pts.contains(AV_NOPTS) else { return }
        let sorted = pts.sorted()
        var shift = reorderDelay
        for (i, p) in pts.enumerated() where sorted[i] - shift > p { shift = sorted[i] - p }
        for (i, packet) in packets.enumerated() { packet.pointee.dts = sorted[i] - shift }
    }

    private func t(of packet: UnsafeMutablePointer<AVPacket>) -> Double {
        let ts = packet.pointee.pts != AV_NOPTS ? packet.pointee.pts : packet.pointee.dts
        return Double(ts) * demuxer.stream(packet.pointee.stream_index).pointee.time_base.seconds
    }
}

/// Writes packets as one fragmented-MP4 segment, with the header in front.
enum FragmentWriter {
    static func write(
        segment index: Int,
        video: UnsafeMutablePointer<AVStream>,
        videoPackets: [UnsafeMutablePointer<AVPacket>],
        audio: UnsafeMutablePointer<AVStream>?,
        audioCodec: UnsafeMutablePointer<AVCodecContext>?,
        audioPackets: [UnsafeMutablePointer<AVPacket>],
        stripDolbyVision: Bool
    ) throws -> Data {
        var out: UnsafeMutablePointer<AVFormatContext>?
        try check(avformat_alloc_output_context2(&out, nil, "mp4", nil), "MP4 writer")
        guard let fmt = out else { throw RemuxError.ffmpeg("MP4 writer") }
        defer { avformat_free_context(fmt) }
        // dvcC (Dolby Vision) is written only at this compliance level.
        fmt.pointee.strict_std_compliance = -1 // FF_COMPLIANCE_UNOFFICIAL
        fmt.pointee.avoid_negative_ts = AVFMT_AVOID_NEG_TS_DISABLED

        // Video, copied, tagged so Apple's player takes it.
        let vOut = avformat_new_stream(fmt, nil)!
        try check(avcodec_parameters_copy(vOut.pointee.codecpar, video.pointee.codecpar), "Video track")
        let par = vOut.pointee.codecpar!
        let hasDolbyVision = av_packet_side_data_get(par.pointee.coded_side_data, par.pointee.nb_coded_side_data, AV_PKT_DATA_DOVI_CONF) != nil
        if stripDolbyVision {
            av_packet_side_data_remove(par.pointee.coded_side_data, &par.pointee.nb_coded_side_data, AV_PKT_DATA_DOVI_CONF)
        }
        switch par.pointee.codec_id {
        case AV_CODEC_ID_HEVC: par.pointee.codec_tag = hasDolbyVision && !stripDolbyVision ? fourCC("dvh1") : fourCC("hvc1")
        case AV_CODEC_ID_H264: par.pointee.codec_tag = fourCC("avc1")
        case AV_CODEC_ID_AV1: par.pointee.codec_tag = fourCC("av01")
        default: par.pointee.codec_tag = 0
        }
        vOut.pointee.time_base = video.pointee.time_base

        var aOut: UnsafeMutablePointer<AVStream>?
        if let audio {
            let s = avformat_new_stream(fmt, nil)!
            if let audioCodec {
                try check(avcodec_parameters_from_context(s.pointee.codecpar, audioCodec), "Audio track")
                s.pointee.time_base = audioCodec.pointee.time_base
            } else {
                try check(avcodec_parameters_copy(s.pointee.codecpar, audio.pointee.codecpar), "Audio track")
                s.pointee.time_base = audio.pointee.time_base
            }
            s.pointee.codecpar.pointee.codec_tag = 0
            aOut = s
        }

        var buffer: UnsafeMutablePointer<AVIOContext>?
        try check(avio_open_dyn_buf(&buffer), "MP4 buffer")
        fmt.pointee.pb = buffer
        var options: OpaquePointer?
        av_dict_set(&options, "movflags", "frag_custom+delay_moov+default_base_moof+frag_discont+skip_trailer", 0)
        av_dict_set(&options, "fragment_index", String(index + 1), 0)
        av_dict_set(&options, "use_editlist", "0", 0)
        av_dict_set(&options, "video_track_timescale", "90000", 0)
        let header = avformat_write_header(fmt, &options)
        av_dict_free(&options)
        if header < 0 {
            var bytes: UnsafeMutablePointer<UInt8>?
            avio_close_dyn_buf(buffer, &bytes)
            av_free(bytes)
            throw RemuxError.ffmpeg("MP4 header: \(ffError(header))")
        }

        // Profile 7: drop the enhancement layer and metadata, keeping the HDR10 base.
        var bsf: UnsafeMutablePointer<AVBSFContext>?
        if stripDolbyVision, let filter = av_bsf_get_by_name("dovi_split"), av_bsf_alloc(filter, &bsf) >= 0, let ctx = bsf {
            avcodec_parameters_copy(ctx.pointee.par_in, video.pointee.codecpar)
            ctx.pointee.time_base_in = video.pointee.time_base
            av_opt_set(ctx.pointee.priv_data, "mode", "bl", 0)
            if av_bsf_init(ctx) < 0 { av_bsf_free(&bsf) }
        }
        defer { if bsf != nil { av_bsf_free(&bsf) } }

        func writeVideo(_ p: UnsafeMutablePointer<AVPacket>) throws {
            p.pointee.stream_index = vOut.pointee.index
            av_packet_rescale_ts(p, video.pointee.time_base, vOut.pointee.time_base)
            if p.pointee.dts == AV_NOPTS { p.pointee.dts = p.pointee.pts }
            try check(av_interleaved_write_frame(fmt, p), "Writing video")
        }

        for source in videoPackets {
            let p = av_packet_clone(source)!
            var owned: UnsafeMutablePointer<AVPacket>? = p
            defer { av_packet_free(&owned) }
            if let bsf {
                guard av_bsf_send_packet(bsf, p) >= 0 else { continue }
                let filtered = av_packet_alloc()!
                var f: UnsafeMutablePointer<AVPacket>? = filtered
                defer { av_packet_free(&f) }
                while av_bsf_receive_packet(bsf, filtered) >= 0 {
                    try writeVideo(filtered)
                    av_packet_unref(filtered)
                }
            } else {
                try writeVideo(p)
            }
        }
        if let aOut, let audio {
            let from = audioCodec?.pointee.time_base ?? audio.pointee.time_base
            for source in audioPackets {
                let p = av_packet_clone(source)!
                var owned: UnsafeMutablePointer<AVPacket>? = p
                defer { av_packet_free(&owned) }
                p.pointee.stream_index = aOut.pointee.index
                av_packet_rescale_ts(p, from, aOut.pointee.time_base)
                if p.pointee.dts == AV_NOPTS { p.pointee.dts = p.pointee.pts }
                try check(av_interleaved_write_frame(fmt, p), "Writing audio")
            }
        }
        // Flushes the interleaving queue, then cuts the fragment.
        av_interleaved_write_frame(fmt, nil)
        av_write_frame(fmt, nil)
        av_write_trailer(fmt)

        var bytes: UnsafeMutablePointer<UInt8>?
        let size = avio_close_dyn_buf(buffer, &bytes)
        fmt.pointee.pb = nil
        defer { av_free(bytes) }
        guard size > 0, let bytes else { throw RemuxError.ffmpeg("The MP4 writer produced nothing.") }
        return Data(bytes: bytes, count: Int(size))
    }
}

/// Splits MP4 output at its top-level boxes: the header (ftyp, moov) and the media
/// (moof, mdat, and anything after).
enum MP4Boxes {
    static func split(_ data: Data) -> (header: Data, media: Data) {
        var offset = 0
        var headerEnd = 0
        var mediaStart: Int?
        while offset + 8 <= data.count {
            let size32 = data.withUnsafeBytes { UInt32(bigEndian: $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self)) }
            let type = String(decoding: data[(data.startIndex + offset + 4)..<(data.startIndex + offset + 8)], as: UTF8.self)
            var size = Int(size32)
            if size32 == 1, offset + 16 <= data.count {
                size = Int(data.withUnsafeBytes { UInt64(bigEndian: $0.loadUnaligned(fromByteOffset: offset + 8, as: UInt64.self)) })
            } else if size32 == 0 {
                size = data.count - offset
            }
            guard size >= 8 else { break }
            if type == "ftyp" || type == "moov" { headerEnd = offset + size }
            if (type == "moof" || type == "styp" || type == "sidx") && mediaStart == nil { mediaStart = offset }
            offset += size
        }
        let header = data.prefix(headerEnd)
        let media = mediaStart.map { data.suffix(from: data.startIndex + $0) } ?? Data()
        return (Data(header), Data(media))
    }
}
