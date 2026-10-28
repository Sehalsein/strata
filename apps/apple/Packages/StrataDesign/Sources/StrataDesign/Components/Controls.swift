import SwiftUI

/// The one primary action: Liquid Glass tinted apricot, dark label.
public struct PlayButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    public init(_ title: String = "Play", systemImage: String = "play.fill", action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.stHeadline)
                .foregroundStyle(Theme.onAccent)
                .padding(.horizontal, Metrics.space2)
                .frame(minHeight: 30)
        }
        .buttonStyle(.glassProminent)
        .tint(Theme.apricot)
        .controlSize(.large)
    }
}

/// Full-width primary action for forms (Continue, Sign In). Apricot glass when
/// enabled; the label switches to `ink-3` when disabled so it stays legible.
public struct PrimaryButton: View {
    let title: String
    let isLoading: Bool
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    public init(_ title: String, isLoading: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isLoading = isLoading
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Group {
                if isLoading { ProgressView().tint(Theme.onAccent) } else { Text(title) }
            }
            .font(.stHeadline)
            .foregroundStyle(isEnabled ? Theme.onAccent : Theme.ink3)
            .frame(maxWidth: .infinity, minHeight: 30)
        }
        .buttonStyle(.glassProminent)
        .tint(Theme.apricot)
        .controlSize(.large)
    }
}

/// A secondary action floating over artwork or video.
public struct GlassButton: View {
    let title: String
    let systemImage: String?
    let iconOnly: Bool
    let action: () -> Void

    public init(_ title: String, systemImage: String? = nil, iconOnly: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.iconOnly = iconOnly
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Group {
                if let systemImage, iconOnly {
                    Image(systemName: systemImage).accessibilityLabel(title)
                } else if let systemImage {
                    Label(title, systemImage: systemImage)
                } else {
                    Text(title)
                }
            }
            .font(.stHeadline)
            .frame(minHeight: 30)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        // Glass labels take the tint: ink, not the app's accent (apricot is for Play only).
        // The system still inverts it for the tvOS focus state.
        .tint(Theme.ink)
    }
}

/// Monospaced technical badge: `2160p`, `HEVC`, `DV`, `EAC3 5.1`.
public struct SpecBadge: View {
    let text: String
    let outlined: Bool

    public init(_ text: String, outlined: Bool = false) {
        self.text = text
        self.outlined = outlined
    }

    public var body: some View {
        Text(text)
            .font(.stSpec)
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 6)
            .frame(minHeight: 20)
            .background {
                RoundedRectangle(cornerRadius: Metrics.radiusXS, style: .continuous)
                    .fill(outlined ? Color.clear : Theme.surface2)
                    .strokeBorder(outlined ? Theme.hairline : .clear, lineWidth: 1)
            }
    }
}

/// Where a source comes from, in the server's words ("Library", …).
public struct OriginBadge: View {
    let label: String
    public init(_ label: String) { self.label = label }

    public var body: some View {
        Text(label)
            .font(.stSpec)
            .foregroundStyle(Theme.local)
            .padding(.horizontal, 6)
            .frame(minHeight: 20)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Metrics.radiusXS, style: .continuous))
    }
}

public struct ProviderBadge: View {
    let kind: ProviderKind
    public init(_ kind: ProviderKind) { self.kind = kind }

    public var body: some View {
        Label(kind.label, systemImage: kind.systemImage)
            .labelStyle(.titleAndIcon)
            .font(.stSpec)
            .foregroundStyle(kind.color)
            .padding(.horizontal, 6)
            .frame(minHeight: 20)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Metrics.radiusXS, style: .continuous))
    }
}

/// Whether something can play, in plain words with a symbol (never color alone).
public enum Availability: Equatable, Sendable {
    case ready, instant, downloading(Double), download, unavailable, watched

    public var title: String {
        switch self {
        case .ready: "Ready"
        case .instant: "Instant"
        case .downloading(let p): "Downloading \(Int(p * 100))%"
        case .download: "Download"
        case .unavailable: "Not in your library"
        case .watched: "Watched"
        }
    }

    public var systemImage: String {
        switch self {
        case .ready: "play.circle.fill"
        case .watched: "checkmark.circle.fill"
        case .instant: "bolt.fill"
        case .downloading, .download: "arrow.down.circle"
        case .unavailable: "minus.circle"
        }
    }

    public var color: Color {
        switch self {
        case .ready, .instant, .watched: Theme.success
        case .downloading, .download: Theme.warning
        case .unavailable: Theme.ink3
        }
    }
}

public struct AvailabilityLabel: View {
    let availability: Availability
    public init(_ availability: Availability) { self.availability = availability }

    public var body: some View {
        Label(availability.title, systemImage: availability.systemImage)
            .font(.stFootnote.weight(.medium))
            .foregroundStyle(availability.color)
    }
}

/// Profile disc with the name's initial, fill chosen stably per profile.
public struct ProfileAvatar: View {
    let name: String
    let seed: String
    let size: CGFloat

    public init(name: String, seed: String, size: CGFloat = 96) {
        self.name = name
        self.seed = seed
        self.size = size
    }

    public var body: some View {
        Circle()
            .fill(Theme.avatarFills[StrataPlaceholder.index(for: seed, count: Theme.avatarFills.count)])
            .frame(width: size, height: size)
            .overlay {
                Text(name.prefix(1).uppercased())
                    .font(.system(size: size * 0.38, weight: .bold))
                    .foregroundStyle(Theme.onAccent)
            }
            .accessibilityLabel(name)
    }
}

/// The app's mark: three bands that stack into a play triangle.
public struct StrataMark: View {
    public init() {}

    public var body: some View {
        Canvas { ctx, size in
            // Same geometry as the app icon, normalised to the mark's bounding box.
            let s = min(size.width / 460, size.height / 500)
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: (x - 300) * s, y: (y - 262) * s) }
            let bands: [([CGPoint], Color)] = [
                ([p(300, 262), p(552, 399), p(300, 399)], Theme.sand),
                ([p(300, 443), p(633, 443), p(760, 512), p(633, 581), p(300, 581)], Theme.apricot),
                ([p(300, 625), p(552, 625), p(300, 762)], Theme.rust),
            ]
            for (points, color) in bands {
                var path = Path()
                path.addLines(points)
                path.closeSubpath()
                ctx.fill(path, with: .color(color))
                ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 16 * s, lineJoin: .round))
            }
        }
        .aspectRatio(460 / 500, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
