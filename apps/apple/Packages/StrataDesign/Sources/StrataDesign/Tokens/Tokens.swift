import SwiftUI

// MARK: - Cinemathèque tokens — mirrors apps/web/src/strata/theme.ts (aurora)
//         and apps/web/src/index.css (@theme block).

public enum Strata {
    public static let cornerRadius: CGFloat = 2

    public enum Tokens {
        public static let bg = Color(hex: 0x0c0a08)
        public static let bg2 = Color(hex: 0x1a1611)
        public static let card = Color(hex: 0x15110c)
        public static let paper = Color(hex: 0xf3e9d3)
        public static let paperDim = Color(hex: 0xf3e9d3, alpha: 0.62)
        public static let paperFaint = Color(hex: 0xf3e9d3, alpha: 0.4)
        public static let paperHair = Color(hex: 0xf3e9d3, alpha: 0.12)
        public static let paperHairStrong = Color(hex: 0xf3e9d3, alpha: 0.22)
        public static let accent = Color(hex: 0xe8331f)
        public static let accent2 = Color(hex: 0xe8b341)
        public static let success = Color(hex: 0x6aa37a)
        public static let danger = Color(hex: 0xe8331f)
        public static let warn = Color(hex: 0xe8b341)
        public static let panel = Color(hex: 0xf3e9d3, alpha: 0.04)
        public static let panelStrong = Color(hex: 0xf3e9d3, alpha: 0.07)
    }
}

public extension Color {
    /// Convenience init from 0xRRGGBB integer literal with optional alpha.
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xff) / 255
        let g = Double((hex >> 8) & 0xff) / 255
        let b = Double(hex & 0xff) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

public extension View {
    /// Sharp 2pt corner that's used everywhere in the Cinemathèque design.
    func strataCard() -> some View {
        clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
    }

    func strataBorder(_ color: Color = Strata.Tokens.paperHair, width: CGFloat = 1) -> some View {
        overlay(
            RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                .stroke(color, lineWidth: width)
        )
    }
}
