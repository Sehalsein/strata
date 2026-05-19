import SwiftUI

public struct GlassPanel<Content: View>: View {
    public let strong: Bool
    @ViewBuilder public var content: Content

    public init(strong: Bool = false, @ViewBuilder content: () -> Content) {
        self.strong = strong
        self.content = content()
    }

    public var body: some View {
        content
            .padding(16)
            .background(strong ? Strata.Tokens.panelStrong : Strata.Tokens.panel)
            .overlay(
                RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                    .stroke(strong ? Strata.Tokens.paperHair : Strata.Tokens.paperHair.opacity(0.8), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
    }
}

public struct NoiseOverlay: View {
    public let opacity: Double
    public init(opacity: Double = 0.05) { self.opacity = opacity }
    public var body: some View {
        Canvas { ctx, size in
            // Lightweight procedural noise. Real shipping app should bake to a PNG.
            let cell: CGFloat = 2
            let cols = Int(size.width / cell)
            let rows = Int(size.height / cell)
            var rng = SystemRandomNumberGenerator()
            for r in 0..<rows {
                for c in 0..<cols {
                    let v = Double.random(in: 0...1, using: &rng)
                    guard v > 0.55 else { continue }
                    let rect = CGRect(x: CGFloat(c) * cell, y: CGFloat(r) * cell, width: cell, height: cell)
                    ctx.fill(Path(rect), with: .color(.white.opacity(v * 0.35)))
                }
            }
        }
        .blendMode(.overlay)
        .opacity(opacity)
        .allowsHitTesting(false)
    }
}

/// Editorial shimmer for skeleton loaders.
public struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    public init() {}

    public func body(content: Content) -> some View {
        content
            .overlay(
                LinearGradient(
                    colors: [.clear, Strata.Tokens.paper.opacity(0.12), .clear],
                    startPoint: .leading, endPoint: .trailing
                )
                .offset(x: phase * 200)
                .blendMode(.plusLighter)
                .mask(content)
            )
            .onAppear {
                withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

public extension View {
    func strataShimmer() -> some View { modifier(Shimmer()) }
}

public struct SkeletonBlock: View {
    public let height: CGFloat
    public init(height: CGFloat = 16) { self.height = height }
    public var body: some View {
        RoundedRectangle(cornerRadius: Strata.cornerRadius)
            .fill(Strata.Tokens.paper.opacity(0.06))
            .frame(height: height)
            .strataShimmer()
    }
}
