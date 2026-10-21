import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Strata design tokens. Values mirror the Strata Design System (`tokens.json`):
/// dark is the primary theme and the only one on tvOS.
public enum Theme {
    // MARK: Surfaces — layers, not shadows
    public static let bg = adaptive(dark: 0x0B0C0F, light: 0xFFFFFF)
    public static let surface1 = adaptive(dark: 0x14161A, light: 0xF4F4F6)
    public static let surface2 = adaptive(dark: 0x1D2025, light: 0xEBEBEF)
    public static let surface3 = adaptive(dark: 0x292D33, light: 0xDFDFE5)
    public static let hairline = adaptive(dark: 0xFFFFFF, light: 0x0B0C0F, darkAlpha: 0.12, lightAlpha: 0.10)

    // MARK: Text
    public static let ink = adaptive(dark: 0xF5F3EF, light: 0x111317)
    public static let ink2 = adaptive(dark: 0xB4B7BE, light: 0x4B4F57)
    public static let ink3 = adaptive(dark: 0x8A8E97, light: 0x62666F)
    /// Text over artwork is always light, whatever the theme.
    public static let onArtwork = Color(hex: 0xF5F3EF)

    // MARK: Brand
    public static let sand = adaptive(dark: 0xF7C873, light: 0xF2B544)
    /// The accent fill: Play, progress, scrubber. Labels on it use `onAccent`.
    public static let apricot = adaptive(dark: 0xF39256, light: 0xF08A48)
    public static let rust = adaptive(dark: 0xD2603F, light: 0xC2502F)
    public static let accentText = adaptive(dark: 0xF6A574, light: 0xB04F17)
    public static let onAccent = Color(hex: 0x1A0E06)

    // MARK: Status and providers (always paired with a word or symbol)
    public static let success = adaptive(dark: 0x4CD08A, light: 0x18804A)
    public static let warning = adaptive(dark: 0xF7C873, light: 0x9A6A00)
    public static let danger = adaptive(dark: 0xFF6B6B, light: 0xC4242C)
    public static let local = adaptive(dark: 0x7DB7FF, light: 0x1F66C9)
    public static let violet = adaptive(dark: 0xB9A4FF, light: 0x6A4FD1)

    public static let scrim = Color.black.opacity(0.7)

    /// Avatar fills, picked stably per profile.
    public static let avatarFills: [Color] = [sand, apricot, local, violet]

    private static func adaptive(dark: UInt32, light: UInt32, darkAlpha: Double = 1, lightAlpha: Double = 1) -> Color {
        #if os(tvOS)
        return Color(hex: dark, alpha: darkAlpha)
        #elseif canImport(UIKit)
        return Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .light ? UIColor(hex: light, alpha: lightAlpha) : UIColor(hex: dark, alpha: darkAlpha)
        })
        #else
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua ? NSColor(hex: light, alpha: lightAlpha) : NSColor(hex: dark, alpha: darkAlpha)
        })
        #endif
    }
}

/// Spacing, radius and per-platform layout tokens.
public enum Metrics {
    public static let space1: CGFloat = 4
    public static let space2: CGFloat = 8
    public static let space3: CGFloat = 12
    public static let space4: CGFloat = 16
    public static let space5: CGFloat = 20
    public static let space6: CGFloat = 24
    public static let space8: CGFloat = 32
    public static let space10: CGFloat = 40
    public static let space12: CGFloat = 48
    public static let space20: CGFloat = 80

    public static let radiusXS: CGFloat = 6
    public static let radiusSM: CGFloat = 10
    public static let radiusMD: CGFloat = 14
    public static let radiusLG: CGFloat = 22

    #if os(tvOS)
    public static let gutter: CGFloat = 80
    public static let posterWidth: CGFloat = 248
    public static let landscapeWidth: CGFloat = 548
    public static let cardGap: CGFloat = 40
    public static let railGap: CGFloat = 48
    public static let cardRadius: CGFloat = radiusLG
    #else
    @MainActor public static var isPad: Bool {
        #if canImport(UIKit)
        UIDevice.current.userInterfaceIdiom == .pad
        #else
        true
        #endif
    }
    /// Matches the system's layout margins, so content lines up with large titles,
    /// toolbars and the tab bar.
    @MainActor public static var gutter: CGFloat { isPad ? 20 : 16 }
    @MainActor public static var posterWidth: CGFloat { isPad ? 160 : 120 }
    @MainActor public static var landscapeWidth: CGFloat { isPad ? 320 : 264 }
    @MainActor public static var cardGap: CGFloat { isPad ? 20 : 12 }
    @MainActor public static var railGap: CGFloat { isPad ? 40 : 32 }
    public static let cardRadius: CGFloat = radiusMD
    #endif
}

public extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }
}

#if canImport(UIKit)
extension UIColor {
    convenience init(hex: UInt32, alpha: Double) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}
#elseif canImport(AppKit)
extension NSColor {
    convenience init(hex: UInt32, alpha: Double) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}
#endif
