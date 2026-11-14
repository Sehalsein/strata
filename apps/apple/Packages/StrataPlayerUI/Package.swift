// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "StrataPlayerUI",
    defaultLocalization: "en",
    platforms: [.iOS("26.0"), .macOS("26.0"), .tvOS("26.0")],
    products: [
        .library(name: "StrataPlayerUI", targets: ["StrataPlayerUI"]),
    ],
    dependencies: [
        .package(path: "../StrataKit"),
        .package(path: "../StrataDesign"),
        .package(path: "../StrataRemux"),
    ],
    targets: [
        .target(
            name: "StrataPlayerUI",
            dependencies: ["StrataKit", "StrataDesign", "StrataRemux"],
            resources: [.copy("Resources/PrivacyInfo.xcprivacy"), .process("Resources/Localizable.xcstrings")]
        ),
        .testTarget(name: "StrataPlayerUITests", dependencies: ["StrataPlayerUI"]),
    ]
)
