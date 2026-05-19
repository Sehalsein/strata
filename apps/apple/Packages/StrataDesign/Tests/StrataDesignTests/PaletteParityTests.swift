import XCTest
@testable import StrataDesign

/// Asserts the Swift port of `hashStr`/`paletteFor`/`motifFor` returns the
/// same values as the JS source-of-truth at `apps/web/src/strata/theme.ts`.
/// Expected values were computed by running the JS implementation against the
/// fixture IDs below.
final class PaletteParityTests: XCTestCase {

    /// (id, expectedHashStr, expectedPaletteIndex, expectedMotifIndex)
    /// Computed from theme.ts via Node:
    ///   const h = s => { let h=0; for (let i=0;i<s.length;i++) h=((h<<5)-h+s.charCodeAt(i))|0; return Math.abs(h); }
    ///   for (const id of fixtures) console.log(id, h(id), h(id)%18, h(id+"::motif")%18)
    private let fixtures: [(id: String, hash: Int, paletteIdx: Int, motifIdx: Int)] = [
        ("", 0, 0, 11),
        ("a", 97, 7, 10),
        ("abc", 96354, 0, 1),
        ("Dune", 2141736, 6, 11),
        ("Blade Runner 2049", 1640741909, 5, 16)
    ]

    func testHashStrParity() {
        for f in fixtures {
            XCTAssertEqual(StrataTheme.hashStr(f.id), f.hash, "hashStr(\"\(f.id)\")")
        }
    }

    func testPaletteIndexParity() {
        for f in fixtures {
            XCTAssertEqual(StrataTheme.paletteIndex(for: f.id), f.paletteIdx, "paletteIndex(\"\(f.id)\")")
        }
    }

    func testMotifIndexParity() {
        for f in fixtures {
            XCTAssertEqual(StrataTheme.motifIndex(for: f.id), f.motifIdx, "motifIndex(\"\(f.id)\")")
        }
    }

    func testPalettesAndMotifsCount() {
        XCTAssertEqual(StrataTheme.palettes.count, 18, "must match PALETTES in theme.ts")
        XCTAssertEqual(StrataTheme.motifs.count, 18, "must match MOTIFS in theme.ts")
    }
}
