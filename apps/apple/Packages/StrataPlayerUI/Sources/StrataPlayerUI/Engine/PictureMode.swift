import Foundation

/// How the player shows the picture: as is (fit), zoomed to fill the screen, or cropped to
/// one of the common film shapes.
public enum PictureMode: Hashable, Sendable {
    case `default`
    case zoomed
    case crop(AspectRatio)
}

/// Common film and TV shapes, narrowest first.
public enum AspectRatio: String, CaseIterable, Identifiable, Hashable, Sendable {
    case academy, imaxTall, hd, flat, imaxDigital, univisium, scope

    public var id: String { rawValue }

    /// Width over height.
    public var ratio: CGFloat {
        switch self {
        case .academy: 4.0 / 3.0
        case .imaxTall: 1.43
        case .hd: 16.0 / 9.0
        case .flat: 1.85
        case .imaxDigital: 1.90
        case .univisium: 2.0
        case .scope: 2.39
        }
    }

    /// The ratio as people write it.
    public var title: String {
        switch self {
        case .academy: "4:3"
        case .imaxTall: "1.43:1"
        case .hd: "16:9"
        case .flat: "1.85:1"
        case .imaxDigital: "1.90:1"
        case .univisium: "2:1"
        case .scope: "2.39:1"
        }
    }

    /// Its name.
    public var name: String {
        switch self {
        case .academy: String(localized: "Academy", bundle: .module)
        case .imaxTall: String(localized: "IMAX", bundle: .module)
        case .hd: String(localized: "Widescreen TV", bundle: .module)
        case .flat: String(localized: "Flat", bundle: .module)
        case .imaxDigital: String(localized: "IMAX Digital", bundle: .module)
        case .univisium: String(localized: "Univisium", bundle: .module)
        case .scope: String(localized: "Scope", bundle: .module)
        }
    }
}
