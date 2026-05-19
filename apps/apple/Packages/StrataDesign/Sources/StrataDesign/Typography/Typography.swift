import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
import CoreText

public extension Font {
    /// Fraunces variable display font. Falls back to a serif system font if the
    /// font file isn't bundled.
    /// - Parameters:
    ///   - size: point size
    ///   - opticalSize: variable `opsz` axis (9–144). Defaults to 144 for headlines.
    ///   - soft: variable `SOFT` axis (0–100). Higher = chunkier, softer counters.
    ///   - wonk: 0 or 1 — toggles wonky alternates.
    static func fraunces(_ size: CGFloat,
                         opticalSize: CGFloat = 144,
                         soft: CGFloat = 50,
                         wonk: Int = 1,
                         weight: PlatformFontWeight = .semibold) -> Font {
        if let platform = Fonts.fraunces(size: size, opsz: opticalSize, soft: soft, wonk: wonk, weight: weight) {
            return Font(platform)
        }
        return .system(size: size, weight: .semibold, design: .serif)
    }

    static func plex(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let names = Fonts.plexName(for: weight)
        for name in names {
            if let f = Fonts.named(name, size: size) { return Font(f) }
        }
        return .system(size: size, weight: weight, design: .default)
    }

    static func mono(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        let names = Fonts.monoName(for: weight)
        for name in names {
            if let f = Fonts.named(name, size: size) { return Font(f) }
        }
        return .system(size: size, weight: weight, design: .monospaced)
    }
}

#if canImport(UIKit)
public typealias PlatformFont = UIFont
public typealias PlatformFontWeight = UIFont.Weight
#elseif canImport(AppKit)
public typealias PlatformFont = NSFont
public typealias PlatformFontWeight = NSFont.Weight
#endif

public enum Fonts {
    static func named(_ name: String, size: CGFloat) -> PlatformFont? {
        #if canImport(UIKit)
        return UIFont(name: name, size: size)
        #elseif canImport(AppKit)
        return NSFont(name: name, size: size)
        #else
        return nil
        #endif
    }

    static func plexName(for weight: Font.Weight) -> [String] {
        switch weight {
        case .bold, .heavy, .black: return ["IBMPlexSans-Bold"]
        case .semibold: return ["IBMPlexSans-SemiBold"]
        case .medium: return ["IBMPlexSans-Medium"]
        default: return ["IBMPlexSans"]
        }
    }

    static func monoName(for weight: Font.Weight) -> [String] {
        switch weight {
        case .bold, .heavy, .black, .semibold: return ["JetBrainsMono-SemiBold", "JetBrainsMono-Bold"]
        case .medium: return ["JetBrainsMono-Medium"]
        default: return ["JetBrainsMono-Regular", "JetBrainsMono"]
        }
    }

    /// Build a Fraunces variable-font instance with the requested axes.
    /// The variable axis tags must match the registered four-letter codes:
    /// `opsz`, `SOFT`, `WONK`, plus `wght` for weight.
    static func fraunces(size: CGFloat, opsz: CGFloat, soft: CGFloat, wonk: Int, weight: PlatformFontWeight) -> PlatformFont? {
        let candidates = ["Fraunces", "Fraunces-Regular", "Fraunces[opsz,wght,SOFT,WONK]"]
        for name in candidates {
            guard let base = named(name, size: size) else { continue }
            return applyVariations(to: base, opsz: opsz, soft: soft, wonk: wonk, weight: weight)
        }
        return nil
    }

    private static func applyVariations(to base: PlatformFont, opsz: CGFloat, soft: CGFloat, wonk: Int, weight: PlatformFontWeight) -> PlatformFont {
        let opszTag = fourCharCode("opsz")
        let softTag = fourCharCode("SOFT")
        let wonkTag = fourCharCode("WONK")
        let wghtTag = fourCharCode("wght")
        let weightVal = weightValue(for: weight)
        let variations: [CFNumber: CFNumber] = [
            opszTag: opsz as CFNumber,
            softTag: soft as CFNumber,
            wonkTag: CGFloat(wonk) as CFNumber,
            wghtTag: weightVal as CFNumber
        ]
        let descriptor = base.fontDescriptor.addingAttributes([
            kCTFontVariationAttribute as PlatformDescriptorKey: variations as CFDictionary
        ])
        #if canImport(UIKit)
        return UIFont(descriptor: descriptor, size: base.pointSize)
        #elseif canImport(AppKit)
        return NSFont(descriptor: descriptor, size: base.pointSize) ?? base
        #endif
    }

    private static func fourCharCode(_ s: String) -> CFNumber {
        var n: UInt32 = 0
        for ch in s.utf8 { n = (n << 8) | UInt32(ch) }
        return n as CFNumber
    }

    private static func weightValue(for weight: PlatformFontWeight) -> CGFloat {
        // map UIFont.Weight (-1.0 ... 1.0 system scale) to CSS-style wght axis (100..900)
        let mapping: [(PlatformFontWeight, CGFloat)] = [
            (.ultraLight, 100), (.thin, 200), (.light, 300), (.regular, 400),
            (.medium, 500), (.semibold, 600), (.bold, 700), (.heavy, 800), (.black, 900)
        ]
        return mapping.first(where: { $0.0 == weight })?.1 ?? 600
    }
}

#if canImport(UIKit)
public typealias PlatformDescriptorKey = UIFontDescriptor.AttributeName
#elseif canImport(AppKit)
public typealias PlatformDescriptorKey = NSFontDescriptor.AttributeName
#endif

// MARK: - Mono spec text helper

public extension Text {
    /// Editorial monospaced spec label — all caps, wide tracking, dim paper.
    func strataSpec() -> some View {
        self
            .font(.mono(10))
            .tracking(1.8)
            .textCase(.uppercase)
            .foregroundStyle(Strata.Tokens.paperDim)
    }
}
