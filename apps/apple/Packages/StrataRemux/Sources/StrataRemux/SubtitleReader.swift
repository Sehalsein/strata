import Foundation
import FFmpeg

/// Text subtitle lines (SRT, ASS/SSA, WebVTT, mov_text) read from the file as the
/// segments around them are, so the server never has to read the whole file for them.
/// Bitmap subtitles (PGS, VobSub) aren't read.
final class SubtitleReader {
    private let demuxer: Demuxer
    private var decoders: [Int32: UnsafeMutablePointer<AVCodecContext>] = [:]
    private static let textCodecs: Set<UInt32> = [
        AV_CODEC_ID_SUBRIP.rawValue, AV_CODEC_ID_SRT.rawValue, AV_CODEC_ID_ASS.rawValue,
        AV_CODEC_ID_SSA.rawValue, AV_CODEC_ID_WEBVTT.rawValue, AV_CODEC_ID_MOV_TEXT.rawValue,
    ]

    init(demuxer: Demuxer) {
        self.demuxer = demuxer
        for i in 0..<demuxer.streamCount {
            let par = demuxer.stream(i).pointee.codecpar.pointee
            guard par.codec_type == AVMEDIA_TYPE_SUBTITLE, Self.textCodecs.contains(par.codec_id.rawValue),
                  let codec = avcodec_find_decoder(par.codec_id), let ctx = avcodec_alloc_context3(codec) else { continue }
            avcodec_parameters_to_context(ctx, demuxer.stream(i).pointee.codecpar)
            ctx.pointee.pkt_timebase = demuxer.stream(i).pointee.time_base
            if avcodec_open2(ctx, codec, nil) >= 0 {
                decoders[i] = ctx
            } else {
                var c: UnsafeMutablePointer<AVCodecContext>? = ctx
                avcodec_free_context(&c)
            }
        }
    }

    deinit {
        for (_, ctx) in decoders {
            var c: UnsafeMutablePointer<AVCodecContext>? = ctx
            avcodec_free_context(&c)
        }
    }

    /// The lines in a subtitle packet, or nil if it isn't one of the text tracks.
    func cues(for packet: UnsafeMutablePointer<AVPacket>) -> [SubtitleCue]? {
        let index = packet.pointee.stream_index
        guard let ctx = decoders[index], packet.pointee.pts != AV_NOPTS else { return nil }
        let tb = demuxer.stream(index).pointee.time_base
        var subtitle = AVSubtitle()
        var got: Int32 = 0
        guard avcodec_decode_subtitle2(ctx, &subtitle, &got, packet) >= 0, got != 0 else { return [] }
        defer { avsubtitle_free(&subtitle) }
        let start = Double(packet.pointee.pts) * tb.seconds + Double(subtitle.start_display_time) / 1000
        let duration = packet.pointee.duration > 0 ? Double(packet.pointee.duration) * tb.seconds : Double(subtitle.end_display_time) / 1000
        var lines: [String] = []
        for i in 0..<Int(subtitle.num_rects) {
            guard let rect = subtitle.rects[i] else { continue }
            if let ass = rect.pointee.ass {
                lines.append(Self.plainText(ass: String(cString: ass)))
            } else if let text = rect.pointee.text {
                lines.append(String(cString: text))
            }
        }
        let text = lines.filter { !$0.isEmpty }.joined(separator: "\n")
        guard !text.isEmpty else { return [] }
        return [SubtitleCue(streamIndex: index, start: start, end: start + max(duration, 0.5), text: text)]
    }

    /// The text of an ASS event line ("ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,
    /// Effect,Text"), without override tags, with \N as line breaks.
    static func plainText(ass: String) -> String {
        let fields = ass.split(separator: ",", maxSplits: 8, omittingEmptySubsequences: false)
        let raw = fields.count == 9 ? String(fields[8]) : ass
        return raw
            .replacingOccurrences(of: #"\{[^}]*\}"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\N", with: "\n")
            .replacingOccurrences(of: "\\n", with: "\n")
            .replacingOccurrences(of: "\\h", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
