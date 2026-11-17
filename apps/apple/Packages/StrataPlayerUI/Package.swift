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
        .package(url: "https://github.com/superuser404notfound/AetherEngine", exact: "7.70.0"),
    ],
    targets: [
        .target(
            name: "StrataPlayerUI",
            dependencies: ["StrataKit", "StrataDesign", .product(name: "AetherEngine", package: "AetherEngine")],
            resources: [.copy("Resources/PrivacyInfo.xcprivacy"), .process("Resources/Localizable.xcstrings")]
        ),
        .testTarget(name: "StrataPlayerUITests", dependencies: ["StrataPlayerUI"], exclude: ["Fixtures"]),
    ]
)
