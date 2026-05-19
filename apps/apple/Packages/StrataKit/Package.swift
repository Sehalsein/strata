// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "StrataKit",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "StrataKit", targets: ["StrataKit"]),
    ],
    targets: [
        .target(name: "StrataKit"),
        .testTarget(name: "StrataKitTests", dependencies: ["StrataKit"]),
    ]
)
