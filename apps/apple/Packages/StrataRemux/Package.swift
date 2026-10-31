// swift-tools-version: 5.10
import PackageDescription

/// Repackages a remote or downloaded file (MKV, MP4, AVI) into fragmented-MP4 HLS on the
/// device, served from a loopback address for AVPlayer. Video is copied; audio is copied,
/// or decoded and kept lossless (ALAC) when the player can't take it (DTS, TrueHD).
/// FFmpeg comes from `scripts/build-ffmpeg.sh` (LGPL-2.1, dynamic).
let package = Package(
    name: "StrataRemux",
    platforms: [.iOS("26.0"), .macOS("26.0"), .tvOS("26.0")],
    products: [
        .library(name: "StrataRemux", targets: ["StrataRemux"]),
    ],
    targets: [
        .binaryTarget(name: "FFmpeg", path: "Frameworks/FFmpeg.xcframework"),
        .target(name: "StrataRemux", dependencies: ["FFmpeg"]),
        .testTarget(name: "StrataRemuxTests", dependencies: ["StrataRemux"], resources: [.copy("Fixtures")]),
    ]
)
