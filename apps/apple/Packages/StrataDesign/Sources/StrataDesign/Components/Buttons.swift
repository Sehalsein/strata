import SwiftUI

/// Primary call-to-action — paper on ink, all caps, sharp corners.
/// Mirrors `.btn-play` / `.strata-btn-primary` from web index.css.
public struct PrimaryButton: View {
    public let title: String
    public let systemImage: String?
    public let action: () -> Void
    @State private var isHovering = false

    public init(_ title: String, systemImage: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        #if os(tvOS)
        // tvOS: bare label + StrataPrimaryButtonStyle owns the chrome so the
        // focus engine drives the visual instead of layering on top of it.
        Button(action: action) {
            HStack(spacing: 10) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
                    .font(.mono(13, weight: .semibold))
                    .tracking(2)
                    .textCase(.uppercase)
            }
        }
        .buttonStyle(StrataPrimaryButtonStyle())
        #else
        Button(action: action) {
            HStack(spacing: 10) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
                    .font(.mono(11, weight: .semibold))
                    .tracking(2)
                    .textCase(.uppercase)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .foregroundStyle(isHovering ? Strata.Tokens.paper : Strata.Tokens.bg)
            .background(isHovering ? Strata.Tokens.accent : Strata.Tokens.paper)
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        #endif
    }
}

public struct SecondaryButton: View {
    public let title: String
    public let systemImage: String?
    public let action: () -> Void
    @State private var isHovering = false

    public init(_ title: String, systemImage: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        #if os(tvOS)
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
                    .font(.mono(13, weight: .semibold))
                    .tracking(2)
                    .textCase(.uppercase)
            }
        }
        .buttonStyle(StrataSecondaryButtonStyle())
        #else
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
                    .font(.mono(11, weight: .semibold))
                    .tracking(2)
                    .textCase(.uppercase)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .foregroundStyle(Strata.Tokens.paper)
            .background(isHovering ? Strata.Tokens.paper.opacity(0.06) : .clear)
            .overlay(
                RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                    .stroke(Strata.Tokens.paper.opacity(isHovering ? 0.7 : 0.35), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        #endif
    }
}
