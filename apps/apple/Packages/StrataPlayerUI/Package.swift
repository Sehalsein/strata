// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "StrataPlayerUI",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "StrataPlayerUI", targets: ["StrataPlayerUI"]),
    ],
    dependencies: [
        .package(path: "../StrataKit"),
        .package(path: "../StrataDesign"),
    ],
    targets: [
        .target(
            name: "StrataPlayerUI",
            dependencies: ["StrataKit", "StrataDesign"]
        ),
    ]
)
