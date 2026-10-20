// swift-tools-version:6.2
import PackageDescription

let package = Package(
    name: "StrataDesign",
    platforms: [.iOS(.v26), .macOS(.v26), .tvOS(.v26)],
    products: [
        .library(name: "StrataDesign", targets: ["StrataDesign"]),
    ],
    targets: [
        .target(name: "StrataDesign", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "StrataDesignTests", dependencies: ["StrataDesign"]),
    ]
)
