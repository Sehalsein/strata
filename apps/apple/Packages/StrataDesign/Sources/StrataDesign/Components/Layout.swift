import SwiftUI

/// A titled horizontal row of cards that bleeds to the screen edges, with the
/// first card aligned to the gutter.
public struct Rail<Content: View>: View {
    let title: String
    let seeAll: (() -> Void)?
    /// The title as a link to the full list ("Trending ›"), pushing a navigation value.
    let titleLink: AnyView?
    @ViewBuilder let content: () -> Content

    public init(_ title: String, seeAll: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.seeAll = seeAll
        self.titleLink = nil
        self.content = content
    }

    /// A rail whose title opens `link` (a value the enclosing stack navigates to); none, a plain title.
    public init<Link: Hashable>(_ title: String, link: Link?, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.seeAll = nil
        self.titleLink = link.map { link in
            AnyView(NavigationLink(value: link) {
                HStack(spacing: 4) {
                    Text(title).railHeaderStyle()
                    Image(systemName: "chevron.right")
                        .font(.stCallout.weight(.bold))
                        .foregroundStyle(Theme.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(RailTitleButtonStyle())
            .accessibilityAddTraits(.isHeader)
            .accessibilityHint("Shows the full list"))
        }
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            header.padding(.horizontal, Metrics.gutter)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: Metrics.cardGap) {
                    content()
                }
                .padding(.horizontal, Metrics.gutter)
                #if os(tvOS)
                .padding(.vertical, Metrics.space8) // room for the focus lift
                #endif
            }
            .scrollClipDisabled()
            #if os(tvOS)
            // Down from a card with nothing straight below it (the end of a long rail over a
            // short one) still lands on the next rail.
            .focusSection()
            #endif
        }
    }
}

extension Rail {
    /// The title; with `link` or `seeAll`, a link to the full list with a chevron, like
    /// the TV app's ("Trending Movies ›"). A `link` title is a navigation link, which takes
    /// focus on tvOS too.
    @ViewBuilder private var header: some View {
        if let titleLink {
            titleLink
        } else {
            actionHeader
        }
    }

    @ViewBuilder private var actionHeader: some View {
        #if os(tvOS)
        Text(title).railHeaderStyle().accessibilityAddTraits(.isHeader)
        #else
        if let seeAll {
            Button(action: seeAll) {
                HStack(spacing: 4) {
                    Text(title).railHeaderStyle()
                    Image(systemName: "chevron.right")
                        .font(.stCallout.weight(.bold))
                        .foregroundStyle(Theme.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHint("Shows all")
        } else {
            Text(title).railHeaderStyle().accessibilityAddTraits(.isHeader)
        }
        #endif
    }
}

/// A rail's "Title ›" link. On the TV it lifts and brightens when focused, like the TV
/// app's, rather than sitting on a white platter its light text can't be read on.
struct RailTitleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Label(configuration: configuration) }

    private struct Label: View {
        let configuration: Configuration
        @Environment(\.isFocused) private var focused

        var body: some View {
            #if os(tvOS)
            configuration.label
                .opacity(focused ? 1 : 0.8)
                .scaleEffect(focused ? 1.08 : 1, anchor: .leading)
                .shadow(color: .black.opacity(focused ? 0.4 : 0), radius: 8, y: 4)
                .animation(.easeOut(duration: 0.15), value: focused)
            #else
            configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
            #endif
        }
    }
}

/// A responsive grid of poster cards (Movies, Shows, search results, My List).
public struct PosterGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content
    /// Side inset; 0 where the page already keeps to the safe area (TV Search).
    let inset: CGFloat
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    /// `inset` defaults to the gutter.
    @MainActor public init(inset: CGFloat? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.inset = inset ?? Metrics.gutter
        self.content = content
    }

    /// Three columns on an iPhone and in a narrow iPad window, rather than two (or one)
    /// oversized ones; the rails' poster size elsewhere.
    private var minimum: CGFloat {
        #if os(iOS)
        sizeClass == .compact ? 100 : Metrics.posterWidth
        #else
        Metrics.posterWidth
        #endif
    }

    public var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: Metrics.cardGap, alignment: .top)],
                  alignment: .leading, spacing: Metrics.gridRowGap) {
            content()
        }
        .padding(.horizontal, inset)
    }
}

/// Artwork-sized placeholder blocks shown while a rail loads.
public struct SkeletonRail: View {
    let aspectRatio: CGFloat
    let width: CGFloat
    let circle: Bool

    /// `circle` for avatar rails (Cast).
    public init(aspectRatio: CGFloat = 2 / 3, width: CGFloat, circle: Bool = false) {
        self.aspectRatio = aspectRatio
        self.width = width
        self.circle = circle
    }

    private var cardHeight: CGFloat { circle ? width : width / aspectRatio }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            SkeletonBar(width: 160, height: 18)
                .padding(.horizontal, Metrics.gutter)
            // More cards than fit, drawn over a row of the cards' height so the
            // overflow is cut off rather than widening the page.
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: cardHeight)
                .overlay(alignment: .leading) {
                    HStack(spacing: Metrics.cardGap) {
                        ForEach(0..<6, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: circle ? width / 2 : Metrics.cardRadius, style: .continuous)
                                .fill(Theme.surface1)
                                .frame(width: width, height: cardHeight)
                        }
                    }
                    .padding(.horizontal, Metrics.gutter)
                }
                .clipped()
        }
        .skeletonPulse()
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

/// A rounded bar standing in for a line of text. Without a width, it fills the line.
public struct SkeletonBar: View {
    let width: CGFloat?
    let height: CGFloat

    public init(width: CGFloat? = nil, height: CGFloat) {
        self.width = width
        self.height = height
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: min(Metrics.radiusXS, height / 2), style: .continuous)
            .fill(Theme.surface2)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

private struct SkeletonPulse: ViewModifier {
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            // Scoped to the opacity: an `.animation(_:value:)` here would also catch the
            // page's own layout as it settles and repeat that forever.
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever()) {
                $0.opacity(dim ? 0.5 : 1)
            }
            .onAppear { dim = true }
    }
}

public extension View {
    /// The slow fade placeholders breathe with while their content loads.
    func skeletonPulse() -> some View { modifier(SkeletonPulse()) }

    /// For a scroll view whose hero art runs up under the navigation bar. On iOS the
    /// bar's scroll edge effect is hidden while the page sits at the top (it cuts a hard
    /// band across the art; the hero shades the top itself) and comes back once the
    /// page scrolls, so the bar still reads over rails. Apply it to the ScrollView.
    func heroUnderBar(_ enabled: Bool = true) -> some View { modifier(HeroUnderBar(enabled: enabled)) }
}

private struct HeroUnderBar: ViewModifier {
    let enabled: Bool
    @State private var atTop = true

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top < 4 } action: { _, top in
                atTop = top
            }
            .scrollEdgeEffectHidden(enabled && atTop, for: .top)
            #endif
            .ignoresSafeArea(edges: enabled ? .top : [])
    }
}

/// Full-area message with an optional retry, for failed loads.
public struct MessageView: View {
    let systemImage: String
    let title: String
    let message: String?
    let actionTitle: String?
    let action: (() -> Void)?

    public init(systemImage: String, title: String, message: String? = nil, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            if let message { Text(message) }
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.glass)
            }
        }
        .foregroundStyle(Theme.ink)
    }
}
