import SwiftUI

/// Procedural editorial motifs — all 18 shapes. Each motif renders a
/// poster-ish backdrop using the title's palette so visual identity is
/// stable across the web ↔ Apple ports.
public struct Motif: View {
    public let key: MotifKey
    public let palette: StrataPalette

    public init(key: MotifKey, palette: StrataPalette) {
        self.key = key
        self.palette = palette
    }

    public var body: some View {
        ZStack {
            palette.c2
            switch key {
            case .sunHorizon:  SunHorizon(palette: palette)
            case .corridor:    Corridor(palette: palette)
            case .atom:        Atom(palette: palette)
            case .risingSun:   RisingSun(palette: palette)
            case .bands:       Bands(palette: palette)
            case .split:       Split(palette: palette)
            case .neon:        Neon(palette: palette)
            case .twinArc:     TwinArc(palette: palette)
            case .archway:     Archway(palette: palette)
            case .rings:       Rings(palette: palette)
            case .aurora:      Aurora(palette: palette)
            case .court:       Court(palette: palette)
            case .eye:          Eye(palette: palette)
            case .moonPrairie: MoonPrairie(palette: palette)
            case .flagTorn:    FlagTorn(palette: palette)
            case .vault:       Vault(palette: palette)
            case .pod:         Pod(palette: palette)
            case .megacity:    Megacity(palette: palette)
            }
        }
        .clipped()
    }
}

// MARK: - Shapes

private struct SunHorizon: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .bottom) {
                LinearGradient(colors: [palette.c1.opacity(0.85), palette.c2],
                               startPoint: .top, endPoint: .bottom)
                Circle().fill(palette.c3.opacity(0.95))
                    .frame(width: w * 0.62, height: w * 0.62)
                    .offset(y: h * 0.18)
                Rectangle().fill(palette.c2.opacity(0.7)).frame(height: h * 0.32)
            }
        }
    }
}

private struct Corridor: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                palette.c2
                ForEach(0..<7) { i in
                    let t = CGFloat(i) / 7
                    Rectangle()
                        .stroke(palette.c1.opacity(0.55 - Double(i) * 0.06), lineWidth: 1)
                        .frame(width: w * (1 - t * 0.85), height: h * (1 - t * 0.85))
                }
                Rectangle().fill(palette.c3.opacity(0.7)).frame(width: w * 0.04, height: h * 0.04)
            }
        }
    }
}

private struct Atom: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            ZStack {
                palette.c2
                ForEach(0..<3) { i in
                    Ellipse().stroke(palette.c3.opacity(0.7), lineWidth: 1.5)
                        .frame(width: s * 0.75, height: s * 0.3)
                        .rotationEffect(.degrees(Double(i) * 60))
                }
                Circle().fill(palette.c1).frame(width: s * 0.18, height: s * 0.18)
                    .shadow(color: palette.c3.opacity(0.6), radius: s * 0.05)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

private struct RisingSun: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .bottom) {
                palette.c2
                Circle().fill(palette.c3.opacity(0.9))
                    .frame(width: w * 0.7, height: w * 0.7)
                    .offset(y: h * 0.4)
                // ray bands
                ForEach(0..<7) { i in
                    Rectangle().fill(palette.c1.opacity(0.45 - Double(i) * 0.04))
                        .frame(width: w * (1 - CGFloat(i) * 0.13), height: 2)
                        .offset(y: -h * (0.05 + CGFloat(i) * 0.07))
                }
            }
        }
    }
}

private struct Bands: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            VStack(spacing: 0) {
                ForEach(0..<9) { i in
                    let col = i % 3 == 0 ? palette.c1 : (i % 3 == 1 ? palette.c2 : palette.c3.opacity(0.92))
                    Rectangle().fill(col).frame(height: h / 9)
                }
            }
        }
    }
}

private struct Split: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                palette.c1
                ZStack {
                    palette.c2
                    Rectangle().fill(palette.c3.opacity(0.6))
                        .frame(width: 2)
                }
            }
            // diagonal slice
            .overlay(
                Path { p in
                    p.move(to: .zero)
                    p.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height))
                    p.addLine(to: CGPoint(x: 0, y: geo.size.height))
                    p.closeSubpath()
                }
                .fill(palette.c2.opacity(0.55))
            )
        }
    }
}

private struct Neon: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                palette.c2
                ForEach(0..<6) { i in
                    let y = h * (0.18 + CGFloat(i) * 0.13)
                    Rectangle()
                        .fill(palette.c3.opacity(0.6 - Double(i) * 0.07))
                        .frame(width: w * (0.85 - CGFloat(i) * 0.06), height: 1.5)
                        .position(x: w / 2, y: y)
                        .shadow(color: palette.c3.opacity(0.7), radius: 4)
                }
                Circle().stroke(palette.c1.opacity(0.5), lineWidth: 1)
                    .frame(width: w * 0.3, height: w * 0.3)
            }
        }
    }
}

private struct TwinArc: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                palette.c2
                ForEach(0..<2) { i in
                    let offset = (i == 0 ? -1.0 : 1.0) * w * 0.18
                    Circle()
                        .stroke(palette.c3.opacity(0.7), lineWidth: 1.5)
                        .frame(width: w * 0.8, height: w * 0.8)
                        .offset(x: offset, y: h * 0.25)
                }
                Rectangle().fill(palette.c1.opacity(0.5))
                    .frame(width: w, height: h * 0.06)
                    .position(x: w / 2, y: h * 0.78)
            }
        }
    }
}

private struct Archway: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .bottom) {
                palette.c2
                Path { p in
                    let archW = w * 0.55, archH = h * 0.75
                    let x0 = (w - archW) / 2
                    p.move(to: CGPoint(x: x0, y: h))
                    p.addLine(to: CGPoint(x: x0, y: h - archH * 0.65))
                    p.addQuadCurve(to: CGPoint(x: x0 + archW, y: h - archH * 0.65),
                                   control: CGPoint(x: w / 2, y: h - archH))
                    p.addLine(to: CGPoint(x: x0 + archW, y: h))
                    p.closeSubpath()
                }
                .fill(palette.c1.opacity(0.92))
                Rectangle().fill(palette.c3.opacity(0.6)).frame(height: 1)
                    .offset(y: -h * 0.18)
            }
        }
    }
}

private struct Rings: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            ZStack {
                palette.c2
                ForEach(0..<5) { i in
                    let scale = 1 - CGFloat(i) * 0.16
                    Circle().stroke(palette.c3.opacity(0.5 + Double(i) * 0.08),
                                    lineWidth: i == 4 ? 4 : 1.2)
                        .frame(width: s * 0.85 * scale, height: s * 0.85 * scale)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

private struct Aurora: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            ZStack {
                palette.c2
                ForEach(0..<3) { i in
                    LinearGradient(
                        colors: [palette.c3.opacity(0.0), palette.c3.opacity(0.7 - Double(i) * 0.18), palette.c3.opacity(0.0)],
                        startPoint: .top, endPoint: .bottom
                    )
                    .frame(width: geo.size.width * 0.35)
                    .offset(x: (CGFloat(i) - 1) * geo.size.width * 0.28)
                    .blur(radius: 18)
                }
                Rectangle().fill(palette.c1.opacity(0.55))
                    .frame(height: geo.size.height * 0.25)
                    .position(x: geo.size.width / 2, y: geo.size.height * 0.88)
            }
        }
    }
}

private struct Court: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                palette.c2
                // tile grid
                Path { p in
                    let step: CGFloat = w / 8
                    for x in stride(from: step, to: w, by: step) {
                        p.move(to: CGPoint(x: x, y: 0))
                        p.addLine(to: CGPoint(x: x, y: h))
                    }
                    for y in stride(from: step, to: h, by: step) {
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: w, y: y))
                    }
                }
                .stroke(palette.c1.opacity(0.45), lineWidth: 0.5)
                Circle().stroke(palette.c3.opacity(0.7), lineWidth: 1)
                    .frame(width: w * 0.36, height: w * 0.36)
            }
        }
    }
}

private struct Eye: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            ZStack {
                palette.c2
                Ellipse().stroke(palette.c3.opacity(0.85), lineWidth: 2)
                    .frame(width: s * 0.85, height: s * 0.5)
                Ellipse().fill(palette.c3.opacity(0.95))
                    .frame(width: s * 0.85, height: s * 0.5)
                    .mask(
                        Ellipse().frame(width: s * 0.85, height: s * 0.5)
                            .mask(
                                Rectangle().frame(height: s * 0.05).offset(y: -s * 0.1)
                            )
                    )
                Circle().fill(palette.c1).frame(width: s * 0.18, height: s * 0.18)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

private struct MoonPrairie: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .bottom) {
                palette.c2
                Circle().fill(palette.c3.opacity(0.92))
                    .frame(width: w * 0.32, height: w * 0.32)
                    .position(x: w * 0.7, y: h * 0.3)
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h * 0.7))
                    p.addQuadCurve(to: CGPoint(x: w, y: h * 0.6),
                                   control: CGPoint(x: w / 2, y: h * 0.85))
                    p.addLine(to: CGPoint(x: w, y: h))
                    p.addLine(to: CGPoint(x: 0, y: h))
                    p.closeSubpath()
                }
                .fill(palette.c1.opacity(0.85))
            }
        }
    }
}

private struct FlagTorn: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                palette.c2
                Path { p in
                    p.move(to: CGPoint(x: 0, y: 0))
                    p.addLine(to: CGPoint(x: w * 0.85, y: 0))
                    p.addLine(to: CGPoint(x: w, y: h * 0.5))
                    p.addLine(to: CGPoint(x: w * 0.85, y: h))
                    p.addLine(to: CGPoint(x: 0, y: h))
                    p.closeSubpath()
                }
                .fill(palette.c1.opacity(0.9))
                ForEach(0..<3) { i in
                    Rectangle().fill(palette.c3.opacity(0.55 - Double(i) * 0.15))
                        .frame(height: 2)
                        .offset(y: -h * 0.18 + CGFloat(i) * 8)
                }
            }
        }
    }
}

private struct Vault: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                palette.c2
                ForEach(0..<4) { i in
                    let scale = 1 - CGFloat(i) * 0.16
                    RoundedRectangle(cornerRadius: w * 0.18 * scale)
                        .stroke(palette.c3.opacity(0.6 + Double(i) * 0.07), lineWidth: 1.5)
                        .frame(width: w * 0.85 * scale, height: h * 0.85 * scale)
                }
                Circle().fill(palette.c1.opacity(0.95))
                    .frame(width: w * 0.16, height: w * 0.16)
            }
        }
    }
}

private struct Pod: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                palette.c2
                Capsule()
                    .fill(palette.c3.opacity(0.85))
                    .frame(width: w * 0.45, height: h * 0.85)
                Capsule()
                    .stroke(palette.c1.opacity(0.7), lineWidth: 1.5)
                    .frame(width: w * 0.45, height: h * 0.85)
                Rectangle().fill(palette.c1.opacity(0.45))
                    .frame(width: w * 0.45, height: 1)
                    .position(x: w / 2, y: h * 0.4)
            }
        }
    }
}

private struct Megacity: View {
    let palette: StrataPalette
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .bottom) {
                palette.c2
                HStack(alignment: .bottom, spacing: 0) {
                    ForEach(0..<14) { i in
                        let heightFraction: CGFloat = [0.25, 0.55, 0.4, 0.75, 0.32, 0.6, 0.45, 0.7, 0.3, 0.55, 0.42, 0.65, 0.35, 0.5][i % 14]
                        Rectangle()
                            .fill(i % 3 == 0 ? palette.c1 : palette.c1.opacity(0.85))
                            .frame(width: w / 14, height: h * heightFraction)
                            .overlay(
                                VStack(spacing: 2) {
                                    ForEach(0..<6) { _ in
                                        Rectangle().fill(palette.c3.opacity(0.55))
                                            .frame(width: w / 28, height: 1)
                                    }
                                }
                                .padding(.top, h * 0.05)
                            )
                    }
                }
            }
        }
    }
}
