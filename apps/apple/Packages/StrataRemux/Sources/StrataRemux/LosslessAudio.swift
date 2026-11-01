import Foundation
import FFmpeg

/// Decodes audio the player can't take (DTS, TrueHD) and re-encodes the samples of one
/// segment losslessly, keeping every channel. ALAC is Apple's own lossless codec, which
/// AVPlayer plays from fragmented MP4. Atmos/DTS:X objects can't survive this (no app can
/// encode them); the bed channels and full resolution do.
final class LosslessAudio {
    private let input: UnsafeMutablePointer<AVStream>
    private var decoder: UnsafeMutablePointer<AVCodecContext>!
    let encoderTemplate: UnsafeMutablePointer<AVCodecContext>
    let sampleRate: Int32

    init(stream: UnsafeMutablePointer<AVStream>) throws {
        input = stream
        guard let codec = avcodec_find_decoder(stream.pointee.codecpar.pointee.codec_id) else {
            throw RemuxError.unsupported("This audio format can't be decoded here.")
        }
        decoder = avcodec_alloc_context3(codec)
        try check(avcodec_parameters_to_context(decoder, stream.pointee.codecpar), "Audio decoder")
        decoder.pointee.pkt_timebase = stream.pointee.time_base
        try check(avcodec_open2(decoder, codec, nil), "Opening the audio decoder")
        sampleRate = decoder.pointee.sample_rate
        encoderTemplate = try Self.makeEncoder(like: decoder)
    }

    deinit {
        avcodec_free_context(&decoder)
        var template: UnsafeMutablePointer<AVCodecContext>? = encoderTemplate
        avcodec_free_context(&template)
    }

    /// An ALAC encoder for the decoder's rate, depth and channels, with a channel layout
    /// ALAC supports for that many channels (5.1 with side surrounds becomes 5.1 back, the
    /// same speakers in ALAC's order).
    static func makeEncoder(like decoder: UnsafeMutablePointer<AVCodecContext>) throws -> UnsafeMutablePointer<AVCodecContext> {
        guard let codec = avcodec_find_encoder(AV_CODEC_ID_ALAC), let ctx = avcodec_alloc_context3(codec) else {
            throw RemuxError.unsupported("Lossless audio encoding isn't available.")
        }
        let deep = decoder.pointee.bits_per_raw_sample > 16 || decoder.pointee.sample_fmt == AV_SAMPLE_FMT_S32 || decoder.pointee.sample_fmt == AV_SAMPLE_FMT_S32P || decoder.pointee.sample_fmt == AV_SAMPLE_FMT_FLTP
        ctx.pointee.sample_fmt = deep ? AV_SAMPLE_FMT_S32P : AV_SAMPLE_FMT_S16P
        if deep { ctx.pointee.bits_per_raw_sample = 24 }
        ctx.pointee.sample_rate = decoder.pointee.sample_rate
        ctx.pointee.time_base = AVRational(num: 1, den: decoder.pointee.sample_rate)

        let channels = decoder.pointee.ch_layout.nb_channels
        var layouts: UnsafeRawPointer?
        var count: Int32 = 0
        avcodec_get_supported_config(ctx, codec, AV_CODEC_CONFIG_CHANNEL_LAYOUT, 0, &layouts, &count)
        var chosen = AVChannelLayout()
        if let list = layouts?.assumingMemoryBound(to: AVChannelLayout.self) {
            for i in 0..<Int(count) where list[i].nb_channels == channels {
                av_channel_layout_copy(&chosen, list.advanced(by: i))
                break
            }
        }
        if chosen.nb_channels == 0 { av_channel_layout_default(&chosen, min(channels, 2)) }
        av_channel_layout_copy(&ctx.pointee.ch_layout, &chosen)
        av_channel_layout_uninit(&chosen)
        ctx.pointee.flags |= AV_CODEC_FLAG_GLOBAL_HEADER
        var c: UnsafeMutablePointer<AVCodecContext>? = ctx
        let opened = avcodec_open2(ctx, codec, nil)
        if opened < 0 {
            avcodec_free_context(&c)
            throw RemuxError.ffmpeg("Lossless audio: \(ffError(opened))")
        }
        return ctx
    }

    /// Forgets decoder state before a new segment (after a seek).
    func reset() { avcodec_flush_buffers(decoder) }

    /// Decoded samples, at their stream time, as the encoder's format.
    struct Chunk {
        let firstSample: Int64
        var planes: [[UInt8]]
        let samples: Int
    }

    private var resampler: OpaquePointer?

    /// Decodes one packet into chunks of encoder-format samples (may be none: the decoder
    /// needs more input, or is still finding its sync after a seek).
    func decode(_ packet: UnsafeMutablePointer<AVPacket>) -> [Chunk] {
        guard avcodec_send_packet(decoder, packet) >= 0 else { return [] }
        var chunks: [Chunk] = []
        var frame = av_frame_alloc()
        defer { av_frame_free(&frame) }
        while avcodec_receive_frame(decoder, frame) >= 0 {
            guard let f = frame else { break }
            let ts = f.pointee.best_effort_timestamp != AV_NOPTS ? f.pointee.best_effort_timestamp : f.pointee.pts
            guard ts != AV_NOPTS, let chunk = convert(f, at: av_rescale_q(ts, input.pointee.time_base, AVRational(num: 1, den: sampleRate))) else { continue }
            chunks.append(chunk)
        }
        return chunks
    }

    private func convert(_ frame: UnsafeMutablePointer<AVFrame>, at firstSample: Int64) -> Chunk? {
        let enc = encoderTemplate
        if resampler == nil {
            var swr: OpaquePointer?
            guard swr_alloc_set_opts2(&swr, &enc.pointee.ch_layout, enc.pointee.sample_fmt, enc.pointee.sample_rate,
                                      &frame.pointee.ch_layout, AVSampleFormat(frame.pointee.format), frame.pointee.sample_rate, 0, nil) >= 0,
                  swr_init(swr) >= 0 else { return nil }
            resampler = swr
        }
        let count = Int(frame.pointee.nb_samples)
        let planesCount = Int(enc.pointee.ch_layout.nb_channels)
        let bytesPerSample = Int(av_get_bytes_per_sample(enc.pointee.sample_fmt))
        let buffers = (0..<planesCount).map { _ in UnsafeMutablePointer<UInt8>.allocate(capacity: max(1, count * bytesPerSample)) }
        defer { buffers.forEach { $0.deallocate() } }
        var outs: [UnsafeMutablePointer<UInt8>?] = buffers
        let converted = outs.withUnsafeMutableBufferPointer { out in
            frame.pointee.extended_data.withMemoryRebound(to: UnsafePointer<UInt8>?.self, capacity: Int(frame.pointee.ch_layout.nb_channels)) { input in
                swr_convert(resampler, out.baseAddress, Int32(count), input, frame.pointee.nb_samples)
            }
        }
        guard converted > 0 else { return nil }
        let n = Int(converted)
        let planes = buffers.map { [UInt8](UnsafeBufferPointer(start: $0, count: n * bytesPerSample)) }
        return Chunk(firstSample: firstSample, planes: planes, samples: n)
    }

    /// Encodes `[start, end)` samples taken from `chunks` (stream sample positions), as
    /// ALAC packets timed in samples. A fresh encoder each segment, so segments are
    /// independent; ALAC has no priming, so they join without a gap.
    func encode(_ chunks: [Chunk], from start: Int64, to end: Int64) throws -> [UnsafeMutablePointer<AVPacket>] {
        let template = encoderTemplate
        guard let codec = avcodec_find_encoder(AV_CODEC_ID_ALAC), let ctx = avcodec_alloc_context3(codec) else { return [] }
        var ctxOpt: UnsafeMutablePointer<AVCodecContext>? = ctx
        defer { avcodec_free_context(&ctxOpt) }
        ctx.pointee.sample_fmt = template.pointee.sample_fmt
        ctx.pointee.bits_per_raw_sample = template.pointee.bits_per_raw_sample
        ctx.pointee.sample_rate = template.pointee.sample_rate
        ctx.pointee.time_base = template.pointee.time_base
        ctx.pointee.flags = template.pointee.flags
        av_channel_layout_copy(&ctx.pointee.ch_layout, &template.pointee.ch_layout)
        try check(avcodec_open2(ctx, codec, nil), "Lossless audio")

        let bytesPerSample = Int(av_get_bytes_per_sample(template.pointee.sample_fmt))
        let channels = Int(template.pointee.ch_layout.nb_channels)
        // Samples of [start, end), in order, as one buffer per channel.
        var merged = [[UInt8]](repeating: [], count: channels)
        var position = start
        for chunk in chunks.sorted(by: { $0.firstSample < $1.firstSample }) {
            let chunkEnd = chunk.firstSample + Int64(chunk.samples)
            guard chunkEnd > position, chunk.firstSample < end else { continue }
            let from = Int(max(position, chunk.firstSample) - chunk.firstSample)
            let to = Int(min(end, chunkEnd) - chunk.firstSample)
            // A gap (missing audio) is filled with silence so timing stays exact.
            let gap = Int(max(0, chunk.firstSample - position))
            for c in 0..<channels {
                if gap > 0 { merged[c].append(contentsOf: [UInt8](repeating: 0, count: gap * bytesPerSample)) }
                merged[c].append(contentsOf: chunk.planes[c][(from * bytesPerSample)..<(to * bytesPerSample)])
            }
            position = min(end, chunkEnd)
        }
        let total = merged.first.map { $0.count / bytesPerSample } ?? 0
        guard total > 0 else { return [] }

        var packets: [UnsafeMutablePointer<AVPacket>] = []
        let frameSize = Int(ctx.pointee.frame_size > 0 ? ctx.pointee.frame_size : 4096)
        var offset = 0
        func drain() {
            while true {
                var packet = av_packet_alloc()
                if avcodec_receive_packet(ctx, packet) < 0 { av_packet_free(&packet); break }
                packets.append(packet!)
            }
        }
        while offset < total {
            let n = min(frameSize, total - offset)
            let frame = av_frame_alloc()!
            frame.pointee.nb_samples = Int32(n)
            frame.pointee.format = template.pointee.sample_fmt.rawValue
            frame.pointee.sample_rate = template.pointee.sample_rate
            av_channel_layout_copy(&frame.pointee.ch_layout, &template.pointee.ch_layout)
            frame.pointee.pts = start + Int64(offset)
            av_frame_get_buffer(frame, 0)
            for c in 0..<channels {
                merged[c].withUnsafeBytes { raw in
                    frame.pointee.extended_data[c]!.update(from: raw.baseAddress!.assumingMemoryBound(to: UInt8.self) + offset * bytesPerSample, count: n * bytesPerSample)
                }
            }
            avcodec_send_frame(ctx, frame)
            var f: UnsafeMutablePointer<AVFrame>? = frame
            av_frame_free(&f)
            drain()
            offset += n
        }
        avcodec_send_frame(ctx, nil)
        drain()
        return packets
    }
}
