import SwiftUI

/// Backdrop wash that bleeds the active palette across the screen background.
/// Mirrors `titleAmbience` from apps/web/src/strata/theme.ts:103-119.
public struct AmbientBackdrop: View {
    public let key: String?
    public let intensity: Double

    public init(key: String?, intensity: Double = 1.0) {
        self.key = key
        self.intensity = intensity
    }

    public var body: some View {
        let palette: StrataPalette? = key.map(StrataTheme.palette(for:))
        ZStack {
            Strata.Tokens.bg
            if let p = palette {
                GeometryReader { geo in
                    let w = geo.size.width, h = geo.size.height
                    ZStack {
                        RadialGradient(
                            colors: [p.c1.opacity(0.32 * intensity), .clear],
                            center: UnitPoint(x: 0.75, y: 0.15),
                            startRadius: 0,
                            endRadius: max(w, h) * 0.7
                        )
                        RadialGradient(
                            colors: [p.c2.opacity(0.22 * intensity), .clear],
                            center: UnitPoint(x: 0.15, y: 0.9),
                            startRadius: 0,
                            endRadius: max(w, h) * 0.6
                        )
                        RadialGradient(
                            colors: [p.c3.opacity(0.14 * intensity), .clear],
                            center: UnitPoint(x: 0.1, y: 0.05),
                            startRadius: 0,
                            endRadius: max(w, h) * 0.55
                        )
                        LinearGradient(
                            colors: [p.c2.opacity(0.08 * intensity), .clear],
                            startPoint: .top, endPoint: .center
                        )
                    }
                    .animation(.easeInOut(duration: 1.1), value: key)
                }
            }
        }
        .ignoresSafeArea()
    }
}
