import SwiftUI

public struct StrataPalette: Equatable, Sendable {
    public let c1: Color
    public let c2: Color
    public let c3: Color
    public let hex1: UInt32
    public let hex2: UInt32
    public let hex3: UInt32

    public init(_ h1: UInt32, _ h2: UInt32, _ h3: UInt32) {
        self.hex1 = h1
        self.hex2 = h2
        self.hex3 = h3
        self.c1 = Color(hex: h1)
        self.c2 = Color(hex: h2)
        self.c3 = Color(hex: h3)
    }
}

public enum MotifKey: String, CaseIterable, Sendable, Hashable {
    case sunHorizon = "sun-horizon"
    case corridor
    case atom
    case risingSun = "rising-sun"
    case bands
    case split
    case neon
    case twinArc = "twin-arc"
    case archway
    case rings
    case aurora
    case court
    case eye
    case moonPrairie = "moon-prairie"
    case flagTorn = "flag-torn"
    case vault
    case pod
    case megacity
}

public enum StrataTheme {
    /// 16 warm, cinematic palettes mirrored 1:1 from apps/web/src/strata/theme.ts:47-66
    public static let palettes: [StrataPalette] = [
        StrataPalette(0xc2683a, 0x1a0d05, 0xf0c987),
        StrataPalette(0xa72a1f, 0x1a0a08, 0xf4d77c),
        StrataPalette(0x3a2412, 0xd97c2b, 0xf4e5c7),
        StrataPalette(0x2a0e0e, 0xc83e2a, 0xf4d77c),
        StrataPalette(0x1a1612, 0xd97c2b, 0xf4e5c7),
        StrataPalette(0x5a4030, 0x1a1410, 0xd8a868),
        StrataPalette(0x6a2818, 0xf0d088, 0x1a0a05),
        StrataPalette(0x1a3a3a, 0x7ec8c0, 0x0e1a1a),
        StrataPalette(0x0d2a4a, 0x7ec8f0, 0xf5f1eb),
        StrataPalette(0x3a5a3a, 0xf4c87a, 0x1a0e2a),
        StrataPalette(0x6a1818, 0x1a0a0a, 0xf0c8a8),
        StrataPalette(0x1a3a4a, 0xc87a3a, 0x0a1a2a),
        StrataPalette(0xd97c2b, 0x1a0a0a, 0x7ec0d0),
        StrataPalette(0x0a1a2a, 0xc87a3a, 0x1a0e2a),
        StrataPalette(0x3a2a6a, 0xf4c87a, 0x1a0e2a),
        StrataPalette(0x6a4818, 0x1a0a05, 0xf0c060),
        StrataPalette(0x3a3a1a, 0x1a1a0a, 0xf4c84a),
        StrataPalette(0x1a2a1a, 0x3aa860, 0xf4e8c2)
    ]

    /// 18 motif keys mirrored 1:1 from theme.ts:68-87.
    public static let motifs: [MotifKey] = [
        .sunHorizon, .corridor, .atom, .risingSun, .bands, .split,
        .neon, .twinArc, .archway, .rings, .aurora, .court,
        .eye, .moonPrairie, .flagTorn, .vault, .pod, .megacity
    ]

    /// Byte-for-byte port of `hashStr` in theme.ts:91-95.
    /// JS: `h = ((h << 5) - h + charCode) | 0` — signed 32-bit overflow wrap.
    public static func hashStr(_ s: String) -> Int {
        var h: Int32 = 0
        for u in s.unicodeScalars {
            h = (h &<< 5) &- h &+ Int32(u.value)
        }
        // JS Math.abs(-Int32.min) is 2147483648 which doesn't fit Int32 — Swift `abs`
        // on Int32.min would trap. Use Int multiplication route, mirroring JS Math.abs.
        return abs(Int(h))
    }

    public static func paletteIndex(for key: String) -> Int {
        hashStr(key) % palettes.count
    }

    public static func palette(for key: String) -> StrataPalette {
        palettes[paletteIndex(for: key)]
    }

    public static func motifIndex(for key: String) -> Int {
        hashStr(key + "::motif") % motifs.count
    }

    public static func motif(for key: String) -> MotifKey {
        motifs[motifIndex(for: key)]
    }

    /// theme.ts:122 — stable opus catalog number per title (100..998)
    public static func opus(for key: String) -> String {
        String((hashStr(key) % 899) + 100)
    }

    /// theme.ts:128 — Roman-numeral volume label
    public static func volume(for key: String) -> String {
        let roman = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"]
        return roman[hashStr(key) % roman.count]
    }
}
