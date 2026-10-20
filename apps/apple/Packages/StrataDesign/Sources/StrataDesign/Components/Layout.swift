import SwiftUI

/// A titled horizontal row of cards that bleeds to the screen edges, with the
/// first card aligned to the gutter.
public struct Rail<Content: View>: View {
    let title: String
    let seeAll: (() -> Void)?
    @ViewBuilder let content: () -> Content

    public init(_ title: String, seeAll: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.seeAll = seeAll
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).railHeaderStyle().accessibilityAddTraits(.isHeader)
                Spacer()
                #if !os(tvOS)
                if let seeAll {
                    Button("See all", action: seeAll)
                        .font(.stCallout)
                        .foregroundStyle(Theme.accentText)
                        .buttonStyle(.plain)
                }
                #endif
            }
            .padding(.horizontal, Metrics.gutter)

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
        }
    }
}

/// A responsive grid of poster cards (Movies, Shows, search results, My List).
public struct PosterGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content
    public init(@ViewBuilder content: @escaping () -> Content) { self.content = content }

    public var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: Metrics.posterWidth), spacing: Metrics.cardGap, alignment: .top)],
                  alignment: .leading, spacing: Metrics.space8) {
            content()
        }
        .padding(.horizontal, Metrics.gutter)
    }
}

/// Artwork-sized placeholder blocks shown while a rail loads.
public struct SkeletonRail: View {
    let aspectRatio: CGFloat
    let width: CGFloat
    @State private var dim = false

    public init(aspectRatio: CGFloat = 2 / 3, width: CGFloat) {
        self.aspectRatio = aspectRatio
        self.width = width
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            RoundedRectangle(cornerRadius: 6).fill(Theme.surface2).frame(width: 160, height: 18)
                .padding(.horizontal, Metrics.gutter)
            HStack(spacing: Metrics.cardGap) {
                ForEach(0..<6, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                        .fill(Theme.surface1)
                        .frame(width: width)
                        .aspectRatio(aspectRatio, contentMode: .fit)
                }
            }
            .padding(.horizontal, Metrics.gutter)
        }
        .opacity(dim ? 0.5 : 1)
        .animation(.easeInOut(duration: 0.9).repeatForever(), value: dim)
        .onAppear { dim = true }
        .accessibilityLabel("Loading")
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
