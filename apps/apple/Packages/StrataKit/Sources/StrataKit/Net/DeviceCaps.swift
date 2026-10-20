import Foundation
import AVFoundation
import VideoToolbox

extension ClientCaps {
    /// What this Apple device can direct-play. Mirrors the server defaults
    /// (`apps/server/src/playback/decide.ts`) and adjusts for the hardware:
    /// - HEVC is always listed (every iOS 17 / tvOS 17 / macOS 14 device decodes it);
    ///   AV1 only where hardware decoding exists (A17 Pro / M3 and later).
    /// - `maxHeight` drops to 1080 on hardware without an HEVC decoder (Apple TV HD).
    /// - HDR formats and Dolby Vision profiles 5/8 when the display path can play HDR.
    public static let current: ClientCaps = {
        var video = ["h264", "hevc"]
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1) { video.append("av1") }
        let hwHEVC = VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)
        let hdrCapable = AVPlayer.eligibleForHDRPlayback
        return ClientCaps(
            containers: ["mp4", "mov", "m4v"],
            videoCodecs: video,
            audioCodecs: ["aac", "ac3", "eac3", "mp3", "alac", "flac"],
            maxHeight: hwHEVC ? 2160 : 1080,
            hdr: hdrCapable ? ["hdr10", "hlg", "dv"] : [],
            // Profile 5 has no HDR10 fallback; without DV support the server transcodes it.
            dvProfiles: hdrCapable ? [5, 8] : [8]
        )
    }()
}
