import SwiftUI

/// Where a title can play from: the server's library.
public enum ProviderKind: String, Hashable, Sendable {
    case library

    public var label: String { "Library" }
    public var systemImage: String { "externaldrive.fill" }
    public var color: Color { Theme.local }
}

/// Press/focus treatment for artwork cards: a lift with shadow on tvOS focus,
/// a slight shrink on touch.
public struct StrataCardStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        CardBody(configuration: configuration)
    }

    private struct CardBody: View {
        let configuration: Configuration
        @Environment(\.isFocused) private var isFocused

        var body: some View {
            configuration.label
                #if os(tvOS)
                .scaleEffect(isFocused ? 1.08 : 1)
                .shadow(color: .black.opacity(isFocused ? 0.6 : 0), radius: isFocused ? 28 : 0, y: isFocused ? 28 : 0)
                #endif
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isFocused)
                .animation(.spring(response: 0.25, dampingFraction: 0.9), value: configuration.isPressed)
        }
    }
}

/// 2:3 poster with title, year/provider dot and optional progress.
public struct PosterCard: View {
    let id: String
    let title: String
    let subtitle: String?
    let imageURL: URL?
    let providers: [ProviderKind]
    let progress: Double?
    let width: CGFloat?
    let action: () -> Void

    public init(id: String, title: String, subtitle: String? = nil, imageURL: URL?, providers: [ProviderKind] = [], progress: Double? = nil, width: CGFloat? = nil, action: @escaping () -> Void) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.imageURL = imageURL
        self.providers = providers
        self.progress = progress
        self.width = width
        self.action = action
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button(action: action) {
                ArtworkImage(url: imageURL, aspectRatio: 2 / 3, seed: id, title: imageURL == nil ? title : nil)
            }
            .buttonStyle(StrataCardStyle())
            .accessibilityLabel(title)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                HStack(spacing: Metrics.space2) {
                    if let provider = providers.first {
                        Circle().fill(provider.color).frame(width: 6, height: 6)
                            .accessibilityLabel("On \(provider.label)")
                    }
                    if let subtitle { Text(subtitle) }
                }
                .font(.stFootnote)
                .foregroundStyle(Theme.ink3)
                if let progress, progress > 0 { ProgressBar(progress).padding(.top, 4) }
            }
        }
        .frame(width: width)
    }
}

/// 16:9 resume card for Continue Watching and Next Up.
public struct ContinueCard: View {
    let id: String
    let overline: String?
    let title: String
    let subtitle: String?
    let imageURL: URL?
    let artworkTitle: String?
    let progress: Double?
    let width: CGFloat?
    let action: () -> Void

    public init(id: String, overline: String?, title: String, subtitle: String?, imageURL: URL?, artworkTitle: String? = nil, progress: Double?, width: CGFloat? = nil, action: @escaping () -> Void) {
        self.id = id
        self.overline = overline
        self.title = title
        self.subtitle = subtitle
        self.imageURL = imageURL
        self.artworkTitle = artworkTitle
        self.progress = progress
        self.width = width
        self.action = action
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button(action: action) {
                ArtworkImage(url: imageURL, aspectRatio: 16 / 9, seed: id, title: imageURL == nil ? (artworkTitle ?? title) : nil)
                    .overlay(alignment: .bottom) {
                        if let progress, progress > 0 {
                            ProgressBar(progress, track: .white.opacity(0.25)).padding(10)
                        }
                    }
                    .overlay(alignment: .center) {
                        Image(systemName: "play.fill")
                            .font(.title2)
                            .foregroundStyle(Theme.onArtwork)
                            .padding(14)
                            .glassEffect(.regular.interactive(), in: .circle)
                            .opacity(0.9)
                    }
            }
            .buttonStyle(StrataCardStyle())
            .accessibilityLabel("Play \(title)")

            VStack(alignment: .leading, spacing: 2) {
                if let overline { Text(overline).eyebrowStyle() }
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                if let subtitle { Text(subtitle).font(.stFootnote).foregroundStyle(Theme.ink3).lineLimit(1) }
            }
        }
        .frame(width: width)
    }
}

/// tvOS focus for rows of text (episodes, a biography). The system's white focus
/// platter washes out light body text, so the focused row lifts onto a dark raised
/// surface with a hairline edge instead. Elsewhere it's a plain button.
public struct FocusLiftStyle: ButtonStyle {
    /// Extra room around the label for the surface (rows that pad themselves need none).
    let inset: CGFloat

    public init(inset: CGFloat = 0) {
        self.inset = inset
    }

    public func makeBody(configuration: Configuration) -> some View {
        #if os(tvOS)
        Body(label: configuration.label, inset: inset)
        #else
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
        #endif
    }

    #if os(tvOS)
    private struct Body<Label: View>: View {
        @Environment(\.isFocused) private var focused
        let label: Label
        let inset: CGFloat

        var body: some View {
            label
                .padding(inset)
                .background {
                    RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous)
                        .fill(focused ? Theme.surface3 : .clear)
                        .strokeBorder(focused ? Theme.hairline : .clear, lineWidth: 1)
                        .shadow(color: .black.opacity(focused ? 0.4 : 0), radius: 18, y: 10)
                }
                .scaleEffect(focused ? 1.02 : 1)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: focused)
                .padding(-inset)
        }
    }
    #endif
}
