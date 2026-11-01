// swift-tools-version:6.2
import PackageDescription

let package = Package(
    name: "StrataFeatures",
    platforms: [.iOS(.v26), .macOS(.v26), .tvOS(.v26)],
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
            dependencies: ["StrataKit", "StrataDesign", "StrataPlayerUI"],
            resources: [
                .copy("Resources/PrivacyInfo.xcprivacy"),
                // Third-party notices and licence texts, shown in Settings > Acknowledgements.
                .copy("Resources/Acknowledgements.plist"),
            ],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
