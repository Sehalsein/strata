import SwiftUI

public struct Chip: View {
    public enum Variant { case `default`, outline, solid, ghost, success, danger }

    public let text: String
    public let variant: Variant

    public init(_ text: String, variant: Variant = .default) {
        self.text = text
        self.variant = variant
    }

    public var body: some View {
        Text(text)
            .font(.mono(10))
            .tracking(1.6)
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(foreground)
            .background(background)
            .overlay(
                RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                    .stroke(border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
    }

    private var foreground: Color {
        switch variant {
        case .solid: return Strata.Tokens.paper
        case .ghost: return Strata.Tokens.paper.opacity(0.5)
        case .success: return Color(hex: 0xb3d4bd)
        case .danger: return Color(hex: 0xf7a99c)
        default: return Strata.Tokens.paper.opacity(0.7)
        }
    }
    private var background: Color {
        switch variant {
        case .default: return Strata.Tokens.paper.opacity(0.05)
        case .solid: return Strata.Tokens.accent
        case .success: return Strata.Tokens.success.opacity(0.1)
        case .danger: return Strata.Tokens.danger.opacity(0.12)
        default: return .clear
        }
    }
    private var border: Color {
        switch variant {
        case .ghost: return .clear
        case .solid: return Strata.Tokens.accent
        case .success: return Strata.Tokens.success.opacity(0.4)
        case .danger: return Strata.Tokens.danger.opacity(0.5)
        default: return Strata.Tokens.paper.opacity(0.18)
        }
    }
}

public struct OpusBadge: View {
    public let key: String
    public init(key: String) { self.key = key }
    public var body: some View {
        HStack(spacing: 4) {
            Text("№").font(.fraunces(11, opticalSize: 14, soft: 100)).italic()
            Text(StrataTheme.opus(for: key)).font(.mono(11))
        }
        .foregroundStyle(Strata.Tokens.paperDim)
        .tracking(1.5)
    }
}
