import Foundation

/// The colour transfer and bit depth an H.264 stream declares in its sequence parameter
/// set. FFmpeg's H.264 parser doesn't read the SPS's colour description, and the H.264
/// decoder (which does) is left out of the build: during avformat_find_stream_info it
/// would decode several frames of every H.264 file. So an MKV that signals HLG or PQ only
/// in the bitstream would read as SDR; this reads it from the extradata instead.
struct H264VUI: Equatable {
    /// ITU-T H.273 transfer characteristics (16 = PQ, 18 = HLG), nil if not declared.
    var transfer: Int?
    var bitDepth: Int

    /// From an `avcC` record (MKV, MP4) or Annex B start-code extradata. Nil when there's
    /// no SPS or it can't be read.
    init?(extradata: Data) {
        guard let sps = Self.firstSPS(extradata), let parsed = Self.parse(sps) else { return nil }
        self = parsed
    }

    private init(transfer: Int?, bitDepth: Int) {
        self.transfer = transfer
        self.bitDepth = bitDepth
    }

    /// The first SPS NAL unit (header byte included).
    private static func firstSPS(_ data: Data) -> [UInt8]? {
        let bytes = [UInt8](data)
        if bytes.count > 6, bytes[0] == 1 {
            // avcC: version, profile, compat, level, length size, then the SPS count and each
            // SPS behind a 16-bit length.
            let count = Int(bytes[5] & 0x1F)
            var at = 6
            for _ in 0..<count {
                guard at + 2 <= bytes.count else { return nil }
                let length = Int(bytes[at]) << 8 | Int(bytes[at + 1])
                at += 2
                guard length > 0, at + length <= bytes.count else { return nil }
                if bytes[at] & 0x1F == 7 { return Array(bytes[at..<(at + length)]) }
                at += length
            }
            return nil
        }
        // Annex B: NAL units after 00 00 01 start codes.
        var i = 0
        while i + 3 < bytes.count {
            if bytes[i] == 0, bytes[i + 1] == 0, bytes[i + 2] == 1 {
                let start = i + 3
                var end = start
                while end + 2 < bytes.count, !(bytes[end] == 0 && bytes[end + 1] == 0 && (bytes[end + 2] == 1 || bytes[end + 2] == 0)) { end += 1 }
                if end + 2 >= bytes.count { end = bytes.count }
                if start < end, bytes[start] & 0x1F == 7 { return Array(bytes[start..<end]) }
                i = end
            } else {
                i += 1
            }
        }
        return nil
    }

    private static func parse(_ nal: [UInt8]) -> H264VUI? {
        var r = BitReader(unescaping: nal.dropFirst())
        do {
            let profile = try r.bits(8)
            _ = try r.bits(16) // constraint flags, level
            _ = try r.ue() // seq_parameter_set_id
            var bitDepth = 8
            if [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].contains(profile) {
                let chroma = try r.ue()
                if chroma == 3 { _ = try r.bits(1) } // separate_colour_plane_flag
                bitDepth = try r.ue() + 8
                _ = try r.ue() // bit_depth_chroma_minus8
                _ = try r.bits(1) // qpprime_y_zero_transform_bypass_flag
                if try r.bits(1) == 1 { // seq_scaling_matrix_present_flag
                    for i in 0..<(chroma == 3 ? 12 : 8) {
                        if try r.bits(1) == 1 { try r.skipScalingList(size: i < 6 ? 16 : 64) }
                    }
                }
            }
            _ = try r.ue() // log2_max_frame_num_minus4
            switch try r.ue() { // pic_order_cnt_type
            case 0: _ = try r.ue()
            case 1:
                _ = try r.bits(1)
                _ = try r.se()
                _ = try r.se()
                for _ in 0..<(try r.ue()) { _ = try r.se() }
            default: break
            }
            _ = try r.ue() // max_num_ref_frames
            _ = try r.bits(1) // gaps_in_frame_num_value_allowed_flag
            _ = try r.ue() // pic_width_in_mbs_minus1
            _ = try r.ue() // pic_height_in_map_units_minus1
            if try r.bits(1) == 0 { _ = try r.bits(1) } // frame_mbs_only_flag, mb_adaptive_frame_field_flag
            _ = try r.bits(1) // direct_8x8_inference_flag
            if try r.bits(1) == 1 { for _ in 0..<4 { _ = try r.ue() } } // frame cropping
            guard try r.bits(1) == 1 else { return H264VUI(transfer: nil, bitDepth: bitDepth) } // vui_parameters_present_flag
            if try r.bits(1) == 1, try r.bits(8) == 255 { _ = try r.bits(32) } // aspect ratio (Extended_SAR)
            if try r.bits(1) == 1 { _ = try r.bits(1) } // overscan
            guard try r.bits(1) == 1 else { return H264VUI(transfer: nil, bitDepth: bitDepth) } // video_signal_type_present_flag
            _ = try r.bits(4) // video_format, video_full_range_flag
            guard try r.bits(1) == 1 else { return H264VUI(transfer: nil, bitDepth: bitDepth) } // colour_description_present_flag
            _ = try r.bits(8) // colour_primaries
            return H264VUI(transfer: try r.bits(8), bitDepth: bitDepth)
        } catch {
            return nil
        }
    }
}

/// Reads an RBSP bit by bit (the emulation-prevention bytes removed first).
private struct BitReader {
    struct End: Error {}
    private let bytes: [UInt8]
    private var bit = 0

    init(unescaping payload: ArraySlice<UInt8>) {
        var out: [UInt8] = []
        out.reserveCapacity(payload.count)
        var zeros = 0
        for b in payload {
            if zeros >= 2, b == 3 { zeros = 0; continue }
            zeros = b == 0 ? zeros + 1 : 0
            out.append(b)
        }
        bytes = out
    }

    mutating func bits(_ n: Int) throws -> Int {
        var value = 0
        for _ in 0..<n {
            guard bit < bytes.count * 8 else { throw End() }
            value = value << 1 | Int(bytes[bit >> 3] >> (7 - UInt8(bit & 7)) & 1)
            bit += 1
        }
        return value
    }

    /// Exp-Golomb, unsigned.
    mutating func ue() throws -> Int {
        var zeros = 0
        while try bits(1) == 0 {
            zeros += 1
            if zeros > 31 { throw End() }
        }
        return (1 << zeros) - 1 + (try bits(zeros))
    }

    /// Exp-Golomb, signed.
    mutating func se() throws -> Int {
        let k = try ue()
        return k & 1 == 1 ? (k + 1) / 2 : -(k / 2)
    }

    mutating func skipScalingList(size: Int) throws {
        var last = 8, next = 8
        for _ in 0..<size {
            if next != 0 { next = (last + (try se()) + 256) % 256 }
            if next != 0 { last = next }
        }
    }
}
