import Foundation
import CoreGraphics
import ImageIO
import FFmpeg

/// Subtitle lines read from the file as the segments around them are, so the server never
/// has to read the whole file for them: text (SRT, ASS/SSA, WebVTT, mov_text) and
/// pictures (PGS, VobSub, DVB), which come out as PNG images placed on the video.
final class SubtitleReader {
    private let demuxer: Demuxer
    private var decoders: [Int32: UnsafeMutablePointer<AVCodecContext>] = [:]
    /// A picture whose end isn't known yet: PGS ends one by sending the stream's next
    /// display set (often an empty one), so it's held until that packet is read.
    private var open: [Int32: SubtitleCue] = [:]
    private static let textCodecs: Set<UInt32> = [
        AV_CODEC_ID_SUBRIP.rawValue, AV_CODEC_ID_SRT.rawValue, AV_CODEC_ID_ASS.rawValue,
        AV_CODEC_ID_SSA.rawValue, AV_CODEC_ID_WEBVTT.rawValue, AV_CODEC_ID_MOV_TEXT.rawValue,
    ]
    private static let pictureCodecs: Set<UInt32> = [
        AV_CODEC_ID_HDMV_PGS_SUBTITLE.rawValue, AV_CODEC_ID_DVD_SUBTITLE.rawValue, AV_CODEC_ID_DVB_SUBTITLE.rawValue,
    ]
    /// A picture is closed by the next one only if that comes within this long; past it
    /// (a seek moved the reading elsewhere), the picture shows for `fallbackSeconds`.
    private static let longestPicture = 20.0
    private static let fallbackSeconds = 4.0

    init(demuxer: Demuxer) {
        self.demuxer = demuxer
        for i in 0..<demuxer.streamCount {
            let par = demuxer.stream(i).pointee.codecpar.pointee
            guard par.codec_type == AVMEDIA_TYPE_SUBTITLE,
                  Self.textCodecs.contains(par.codec_id.rawValue) || Self.pictureCodecs.contains(par.codec_id.rawValue),
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

    /// The lines in a subtitle packet, or nil if it isn't one of the subtitle tracks read.
    /// A picture packet can also return the picture before it, now that its end is known.
    func cues(for packet: UnsafeMutablePointer<AVPacket>) -> [SubtitleCue]? {
        let index = packet.pointee.stream_index
        guard let ctx = decoders[index], packet.pointee.pts != AV_NOPTS else { return nil }
        let tb = demuxer.stream(index).pointee.time_base
        var subtitle = AVSubtitle()
        var got: Int32 = 0
        guard avcodec_decode_subtitle2(ctx, &subtitle, &got, packet) >= 0, got != 0 else { return [] }
        defer { avsubtitle_free(&subtitle) }
        let base = Double(packet.pointee.pts) * tb.seconds
        let start = base + Double(subtitle.start_display_time) / 1000
        if Self.pictureCodecs.contains(ctx.pointee.codec_id.rawValue) {
            return pictureCues(subtitle, stream: index, ctx: ctx, base: base, start: start,
                               packetDuration: packet.pointee.duration > 0 ? Double(packet.pointee.duration) * tb.seconds : nil)
        }
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

    private func pictureCues(_ subtitle: AVSubtitle, stream: Int32, ctx: UnsafeMutablePointer<AVCodecContext>,
                             base: Double, start: Double, packetDuration: Double?) -> [SubtitleCue] {
        var out: [SubtitleCue] = []
        if let pending = open.removeValue(forKey: stream) {
            let gap = start - pending.start
            out.append(pending.ending(at: gap > 0 && gap <= Self.longestPicture ? start : pending.start + Self.fallbackSeconds))
        }
        // No rects: the display set that clears the screen.
        let video = demuxer.stream(demuxer.videoIndex).pointee.codecpar.pointee
        let canvasWidth = ctx.pointee.width > 0 ? Int(ctx.pointee.width) : Int(video.width)
        let canvasHeight = ctx.pointee.height > 0 ? Int(ctx.pointee.height) : Int(video.height)
        let rects = (0..<Int(subtitle.num_rects)).compactMap { subtitle.rects[$0] }.filter { $0.pointee.type == SUBTITLE_BITMAP }
        guard let image = Self.picture(rects.map(Self.bitmap(of:)), canvasWidth: canvasWidth, canvasHeight: canvasHeight) else { return out }
        let shown = subtitle.end_display_time
        if shown > 0, shown != UInt32.max, Double(shown) / 1000 > Double(subtitle.start_display_time) / 1000 {
            out.append(SubtitleCue(streamIndex: stream, start: start, end: base + Double(shown) / 1000, text: "", image: image))
        } else if let packetDuration {
            out.append(SubtitleCue(streamIndex: stream, start: start, end: start + packetDuration, text: "", image: image))
        } else {
            open[stream] = SubtitleCue(streamIndex: stream, start: start, end: start, text: "", image: image)
        }
        return out
    }

    /// One bitmap rect of a decoded subtitle: palette indices and the palette (0xAARRGGBB).
    struct Bitmap {
        var x: Int, y: Int, width: Int, height: Int
        var indices: [UInt8]
        var stride: Int
        var palette: [UInt32]
    }

    static func bitmap(of rect: UnsafeMutablePointer<AVSubtitleRect>) -> Bitmap {
        let r = rect.pointee
        let w = Int(r.w), h = Int(r.h), stride = Int(r.linesize.0)
        let indices = r.data.0.map { [UInt8](UnsafeBufferPointer(start: $0, count: stride * h)) } ?? []
        let colors = Int(r.nb_colors)
        let palette = r.data.1.map { raw in
            UnsafeRawPointer(raw).withMemoryRebound(to: UInt32.self, capacity: colors) { [UInt32](UnsafeBufferPointer(start: $0, count: colors)) }
        } ?? []
        return Bitmap(x: Int(r.x), y: Int(r.y), width: w, height: h, indices: indices, stride: stride, palette: palette)
    }

    /// The rects drawn into one PNG covering all of them, placed as fractions of the canvas
    /// (the video frame the subtitle was authored for). Nil when nothing would show.
    static func picture(_ rects: [Bitmap], canvasWidth: Int, canvasHeight: Int) -> SubtitleImage? {
        let rects = rects.filter { $0.width > 0 && $0.height > 0 && $0.indices.count >= $0.stride * $0.height }
        guard !rects.isEmpty else { return nil }
        let minX = rects.map(\.x).min()!, minY = rects.map(\.y).min()!
        let maxX = rects.map { $0.x + $0.width }.max()!, maxY = rects.map { $0.y + $0.height }.max()!
        let width = maxX - minX, height = maxY - minY
        // Premultiplied RGBA, as Core Graphics takes it.
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        var visible = false
        for rect in rects {
            for row in 0..<rect.height {
                for col in 0..<rect.width {
                    let i = Int(rect.indices[row * rect.stride + col])
                    guard i < rect.palette.count else { continue }
                    let argb = rect.palette[i]
                    let a = UInt32(argb >> 24)
                    guard a > 0 else { continue }
                    visible = true
                    let o = ((rect.y - minY + row) * width + (rect.x - minX + col)) * 4
                    pixels[o] = UInt8(((argb >> 16) & 0xFF) * a / 255)
                    pixels[o + 1] = UInt8(((argb >> 8) & 0xFF) * a / 255)
                    pixels[o + 2] = UInt8((argb & 0xFF) * a / 255)
                    pixels[o + 3] = UInt8(a)
                }
            }
        }
        guard visible, let png = png(pixels, width: width, height: height) else { return nil }
        let cw = Double(max(canvasWidth, maxX)), ch = Double(max(canvasHeight, maxY))
        return SubtitleImage(png: png, x: Double(minX) / cw, y: Double(minY) / ch, width: Double(width) / cw, height: Double(height) / ch)
    }

    private static func png(_ pixels: [UInt8], width: Int, height: Int) -> Data? {
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { return nil }
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
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
