// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "StrataDesign",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "StrataDesign", targets: ["StrataDesign"]),
    ],
    targets: [
        .target(name: "StrataDesign"),
        .testTarget(name: "StrataDesignTests", dependencies: ["StrataDesign"]),
    ]
)
