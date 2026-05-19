import SwiftUI

// MARK: - tvOS focus styling
//
// Apple TV's default focus engine applies a bright drop-shadow "lift" and
// parallax that fights the Cinemathèque language (paper-on-ink, sharp 2pt
// corners, restrained metallic accents). These ButtonStyles take over the
// visual treatment so a focused control reads as a film-festival call-out
// rather than a glossy tile. They are tvOS-only — call sites use
// `#if os(tvOS)` to pick them up and keep the existing inline visuals on
// iOS / iPadOS / macOS.

#if os(tvOS)

/// Primary CTA on tvOS — fills with `paper` on focus and reverses the label.
public struct StrataPrimaryButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        StrataPrimaryButtonBody(configuration: configuration)
    }
}

private struct StrataPrimaryButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        configuration.label
            .foregroundStyle(isFocused ? Strata.Tokens.bg : Strata.Tokens.paper)
            .padding(.horizontal, 30)
            .padding(.vertical, 16)
            .background(isFocused ? Strata.Tokens.paper : Strata.Tokens.paper.opacity(0.10))
            .overlay(
                RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                    .stroke(isFocused ? .clear : Strata.Tokens.paperHairStrong, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : (isFocused ? 1.04 : 1.0))
            .animation(.easeOut(duration: 0.18), value: isFocused)
            .animation(.easeOut(duration: 0.10), value: configuration.isPressed)
    }
}

/// Outlined / ghost button on tvOS — hairline thickens on focus.
public struct StrataSecondaryButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        StrataSecondaryButtonBody(configuration: configuration)
    }
}

private struct StrataSecondaryButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        configuration.label
            .foregroundStyle(Strata.Tokens.paper)
            .padding(.horizontal, 30)
            .padding(.vertical, 16)
            .background(isFocused ? Strata.Tokens.paper.opacity(0.07) : .clear)
            .overlay(
                RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                    .stroke(isFocused ? Strata.Tokens.paper.opacity(0.85) : Strata.Tokens.paperHair,
                            lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : (isFocused ? 1.04 : 1.0))
            .animation(.easeOut(duration: 0.18), value: isFocused)
            .animation(.easeOut(duration: 0.10), value: configuration.isPressed)
    }
}

/// Poster / card wrapper. The label keeps its own visual identity; focus
/// is communicated with a single paper hairline and a 1.06 scale. No
/// floating shadow, no parallax — keeps the editorial flatness.
public struct StrataCardButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        StrataCardButtonBody(configuration: configuration)
    }
}

private struct StrataCardButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        configuration.label
            .overlay(
                RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                    .stroke(isFocused ? Strata.Tokens.paper : Color.clear, lineWidth: 2)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : (isFocused ? 1.06 : 1.0))
            .animation(.easeOut(duration: 0.22), value: isFocused)
            .animation(.easeOut(duration: 0.10), value: configuration.isPressed)
    }
}

#endif
