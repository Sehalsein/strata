// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "StrataKit",
    defaultLocalization: "en",
    platforms: [.iOS("26.0"), .macOS("26.0"), .tvOS("26.0")],
    products: [
        .library(name: "StrataKit", targets: ["StrataKit"]),
    ],
    targets: [
        .target(name: "StrataKit", resources: [.copy("Resources/PrivacyInfo.xcprivacy"), .process("Resources/Localizable.xcstrings")]),
        .testTarget(name: "StrataKitTests", dependencies: ["StrataKit"], resources: [.copy("Fixtures")]),
    ]
)
