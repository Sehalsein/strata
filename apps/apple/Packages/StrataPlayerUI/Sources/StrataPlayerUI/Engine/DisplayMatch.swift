#if os(tvOS)
import AVFoundation
import AVKit
import StrataRemux

/// What an Apple TV switches its output to for a title when "Match Content" is on in
/// Settings: the video's frame rate and dynamic range (HDR10, HLG, Dolby Vision or SDR).
enum DisplayMatch {
    /// From what StrataRemux read in the file's header (device mode).
    static func criteria(for format: RemuxSession.VideoFormat) -> AVDisplayCriteria? {
        let codec: CMVideoCodecType = switch format.codec {
        case .hevc: format.dolbyVision ? kCMVideoCodecType_DolbyVisionHEVC : kCMVideoCodecType_HEVC
        case .h264: kCMVideoCodecType_H264
        case .av1: kCMVideoCodecType_AV1
        case .other: kCMVideoCodecType_HEVC
        }
        let hdr = format.range == "PQ" || format.range == "HLG"
        let transfer = switch format.range {
        case "PQ": kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ
        case "HLG": kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG
        default: kCMFormatDescriptionTransferFunction_ITU_R_709_2
        }
        let extensions: [CFString: Any] = [
            kCMFormatDescriptionExtension_TransferFunction: transfer,
            kCMFormatDescriptionExtension_ColorPrimaries: hdr ? kCMFormatDescriptionColorPrimaries_ITU_R_2020 : kCMFormatDescriptionColorPrimaries_ITU_R_709_2,
            kCMFormatDescriptionExtension_YCbCrMatrix: hdr ? kCMFormatDescriptionYCbCrMatrix_ITU_R_2020 : kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2,
            kCMFormatDescriptionExtension_BitsPerComponent: hdr ? 10 : 8,
        ]
        var description: CMVideoFormatDescription?
        let status = CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: codec,
                                                    width: Int32(max(1, format.width)), height: Int32(max(1, format.height)),
                                                    extensions: extensions as CFDictionary, formatDescriptionOut: &description)
        guard status == noErr, let description else { return nil }
        return AVDisplayCriteria(refreshRate: Float(format.frameRate ?? 0), formatDescription: description)
    }

    /// What the asset asks for (an HLS stream from its playlist), loaded as soon as the item
    /// exists; for a direct file, its own video track when the asset doesn't say.
    static func criteria(loading asset: AVAsset, direct: Bool) async -> AVDisplayCriteria? {
        if let criteria = try? await asset.load(.preferredDisplayCriteria) { return criteria }
        return direct ? await criteria(for: asset) : nil
    }

    /// From the file's own video track (direct play of an MP4).
    static func criteria(for asset: AVAsset) async -> AVDisplayCriteria? {
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let (descriptions, rate) = try? await track.load(.formatDescriptions, .nominalFrameRate),
              let description = descriptions.first else { return nil }
        return AVDisplayCriteria(refreshRate: rate, formatDescription: description)
    }
}
#endif
