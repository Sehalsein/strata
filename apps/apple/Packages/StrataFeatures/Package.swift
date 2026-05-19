// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "StrataFeatures",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "StrataFeatures", targets: ["StrataFeatures"]),
    ],
    dependencies: [
        .package(path: "../StrataKit"),
        .package(path: "../StrataDesign"),
        .package(path: "../StrataPlayerUI"),
    ],
    targets: [
        .target(
            name: "StrataFeatures",
            dependencies: ["StrataKit", "StrataDesign", "StrataPlayerUI"]
        ),
    ]
)
