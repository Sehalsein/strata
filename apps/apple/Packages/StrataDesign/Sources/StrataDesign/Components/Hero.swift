import SwiftUI

/// Full-bleed backdrop with title, one metadata line, overview and glass
/// actions. Used at the top of detail pages and the tvOS Home.
public struct HeroBillboard<Actions: View>: View {
    let id: String
    let backdropURL: URL?
    let eyebrow: String?
    let title: String
    let meta: [String]
    let badges: [String]
    let overview: String?
    @ViewBuilder let actions: () -> Actions

    public init(id: String, backdropURL: URL?, eyebrow: String? = nil, title: String, meta: [String] = [], badges: [String] = [], overview: String? = nil, @ViewBuilder actions: @escaping () -> Actions) {
        self.id = id
        self.backdropURL = backdropURL
        self.eyebrow = eyebrow
        self.title = title
        self.meta = meta
        self.badges = badges
        self.overview = overview
        self.actions = actions
    }

    #if os(tvOS)
    private let height: CGFloat = 860
    private let titleFont = Font.stDisplayTV
    private let overviewLines = 3
    #else
    private var height: CGFloat { Metrics.isPad ? 620 : 520 }
    private let titleFont = Font.stDisplay
    private var overviewLines: Int { Metrics.isPad ? 4 : 3 }
    #endif

    public var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: backdropURL, transaction: Transaction(animation: .easeOut(duration: 0.3))) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    StrataPlaceholder(seed: id)
                }
            }
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .clipped()
            .accessibilityHidden(true)

            LinearGradient(stops: [
                .init(color: Theme.bg.opacity(0), location: 0.25),
                .init(color: Theme.scrim, location: 0.75),
                .init(color: Theme.bg, location: 1),
            ], startPoint: .top, endPoint: .bottom)

            VStack(alignment: .leading, spacing: Metrics.space3) {
                if let eyebrow { Text(eyebrow).eyebrowStyle(Theme.onArtwork.opacity(0.75)) }
                Text(title)
                    .font(titleFont)
                    .titleTracking()
                    .foregroundStyle(Theme.onArtwork)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .accessibilityAddTraits(.isHeader)
                if !meta.isEmpty || !badges.isEmpty {
                    HStack(spacing: Metrics.space2) {
                        if !meta.isEmpty {
                            Text(meta.joined(separator: " · ")).font(.stCallout).foregroundStyle(Theme.onArtwork.opacity(0.8))
                        }
                        ForEach(badges, id: \.self) { SpecBadge($0) }
                    }
                }
                if let overview, !overview.isEmpty {
                    Text(overview)
                        .font(.stCallout)
                        .foregroundStyle(Theme.onArtwork.opacity(0.8))
                        .lineLimit(overviewLines)
                        .frame(maxWidth: 620, alignment: .leading)
                }
                GlassEffectContainer(spacing: Metrics.space2) {
                    HStack(spacing: Metrics.space2) { actions() }
                }
                .padding(.top, Metrics.space2)
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.bottom, Metrics.space8)
        }
        .frame(height: height)
    }
}

/// One episode in a season list.
public struct EpisodeRow<Trailing: View>: View {
    let id: String
    let number: Int
    let title: String
    let overview: String?
    let foot: String?
    let stillURL: URL?
    let progress: Double?
    let isCurrent: Bool
    @ViewBuilder let trailing: () -> Trailing

    public init(id: String, number: Int, title: String, overview: String?, foot: String?, stillURL: URL?, progress: Double?, isCurrent: Bool = false, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.id = id
        self.number = number
        self.title = title
        self.overview = overview
        self.foot = foot
        self.stillURL = stillURL
        self.progress = progress
        self.isCurrent = isCurrent
        self.trailing = trailing
    }

    #if os(tvOS)
    private let stillWidth: CGFloat = 320
    #else
    private var stillWidth: CGFloat { Metrics.isPad ? 220 : 140 }
    #endif

    public var body: some View {
        HStack(alignment: .top, spacing: Metrics.space4) {
            ArtworkImage(url: stillURL, aspectRatio: 16 / 9, seed: id, cornerRadius: Metrics.radiusSM)
                .frame(width: stillWidth)
                .overlay(alignment: .bottom) {
                    if let progress, progress > 0 { ProgressBar(progress, track: .white.opacity(0.25)).padding(6) }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text("\(number). \(title)").font(.stHeadline).foregroundStyle(Theme.ink).lineLimit(2)
                if let overview, !overview.isEmpty {
                    Text(overview).font(.stCallout).foregroundStyle(Theme.ink2).lineLimit(Metrics.isPadOrTV ? 2 : 1)
                }
                if let foot { Text(foot).font(.stFootnote).foregroundStyle(Theme.ink3) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .padding(.vertical, Metrics.space3)
        .padding(.horizontal, Metrics.space4)
        .background(isCurrent ? Theme.surface3 : .clear)
        .contentShape(Rectangle())
    }
}

public extension Metrics {
    @MainActor static var isPadOrTV: Bool {
        #if os(tvOS)
        true
        #else
        isPad
        #endif
    }
}
