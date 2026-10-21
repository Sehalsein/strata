import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Full-bleed backdrop with title, one metadata line, overview and glass
/// actions. Used at the top of detail pages and the tvOS Home.
public struct HeroBillboard<Actions: View>: View {
    let id: String
    let backdropURL: URL?
    let fallbackURL: URL?
    let eyebrow: String?
    let title: String
    let meta: [String]
    let badges: [String]
    let overview: String?
    @ViewBuilder let actions: () -> Actions
    @Environment(\.colorScheme) private var colorScheme

    public init(id: String, backdropURL: URL?, fallbackURL: URL? = nil, eyebrow: String? = nil, title: String, meta: [String] = [], badges: [String] = [], overview: String? = nil, @ViewBuilder actions: @escaping () -> Actions) {
        self.id = id
        self.backdropURL = backdropURL
        self.fallbackURL = fallbackURL
        self.eyebrow = eyebrow
        self.title = title
        self.meta = meta
        self.badges = badges
        self.overview = overview
        self.actions = actions
    }

    #if os(tvOS)
    private static var backdropPixels: Int { 1920 }
    #else
    private static var backdropPixels: Int { 1600 }
    #endif

    #if os(tvOS)
    private let titleFont = Font.stDisplayTV
    private let overviewLines = 4
    #else
    private var height: CGFloat { Metrics.isPad ? 620 : 520 }
    private let titleFont = Font.stDisplay
    private var overviewLines: Int { Metrics.isPad ? 4 : 3 }
    #endif

    public var body: some View {
        ZStack(alignment: .bottomLeading) {
            backdrop
            scrims
            #if os(tvOS)
            tvInfo
            #else
            info
            #endif
        }
        #if os(tvOS)
        // Like the TV app: the art fills the whole screen, safe areas included,
        // and the page's other sections start below the fold.
        .frame(height: UIScreen.main.bounds.height)
        #else
        .frame(height: height)
        #endif
    }

    /// The backdrop; without one, the poster blurred to fill; without either, a
    /// full-bleed placeholder. Whichever it is runs to the top edge of the page.
    private var backdrop: some View {
        let blurred = backdropURL == nil
        // The container sets the size and the image fills it as an overlay: an
        // aspect-fill image laid out directly would widen the page past the screen.
        return Color.clear
            .overlay {
                // A blurred poster needs few pixels; a backdrop, about the screen's width.
                RemoteImage(url: backdropURL ?? fallbackURL, maxPixel: blurred ? 320 : Self.backdropPixels, blur: blurred ? 40 : 0) {
                    StrataPlaceholder.hero(seed: id)
                }
            }
            .clipped()
            .accessibilityHidden(true)
    }

    @ViewBuilder private var scrims: some View {
        #if os(tvOS)
        // A left-side wash keeps the title legible over bright art; it sits under
        // the bottom fade so the hero ends in plain `bg` with no seam.
        LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .leading, endPoint: .center)
        #endif
        if colorScheme == .light {
            // Light: the art dissolves straight into the page (no dark step, which turns
            // grey on white), and the text below sits on the page in ink.
            LinearGradient(stops: Self.eased(from: 0.3, to: 0.82) { Theme.bg.opacity($0) }, startPoint: .top, endPoint: .bottom)
        } else {
            LinearGradient(stops: Self.eased(from: 0.35, to: 0.8) { Color.black.opacity(0.7 * $0) }
                + [.init(color: Theme.bg, location: 1)], startPoint: .top, endPoint: .bottom)
        }
    }

    /// An ease-in-out ramp as gradient stops, so the fade has no visible start or end.
    private static func eased(from start: CGFloat, to end: CGFloat, _ color: (Double) -> Color) -> [Gradient.Stop] {
        (0...8).map { i in
            let t = Double(i) / 8
            let eased = t * t * (3 - 2 * t)
            return .init(color: color(eased), location: start + (end - start) * t)
        }
    }

    /// Text over the hero: light on the art, ink where the page shows through (light mode).
    private var heroText: Color { colorScheme == .light ? Theme.ink : Theme.onArtwork }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            if let eyebrow { Text(eyebrow).eyebrowStyle(heroText.opacity(0.75)) }
            Text(title)
                .font(titleFont)
                .titleTracking()
                .foregroundStyle(heroText)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
                .accessibilityAddTraits(.isHeader)
            if !meta.isEmpty || !badges.isEmpty {
                HStack(spacing: Metrics.space2) {
                    if !meta.isEmpty {
                        Text(meta.joined(separator: " · ")).font(.stCallout).foregroundStyle(heroText.opacity(0.8))
                    }
                    ForEach(badges, id: \.self) { SpecBadge($0) }
                }
            }
        }
    }

    private var actionRow: some View {
        GlassEffectContainer(spacing: Metrics.space2) {
            HStack(spacing: Metrics.space3) { actions() }
        }
    }

    @ViewBuilder private var overviewText: some View {
        if let overview, !overview.isEmpty {
            Text(overview)
                .font(.stCallout)
                .foregroundStyle(heroText.opacity(0.8))
                .lineLimit(overviewLines)
        }
    }

    #if os(tvOS)
    /// Title block over the actions, with the overview beside them.
    private var tvInfo: some View {
        VStack(alignment: .leading, spacing: Metrics.space6) {
            titleBlock.frame(maxWidth: 1000, alignment: .leading)
            HStack(alignment: .top, spacing: Metrics.space12) {
                actionRow
                overviewText.frame(maxWidth: 760, alignment: .leading)
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.bottom, Metrics.space20)
    }
    #else
    private var info: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            titleBlock
            overviewText.frame(maxWidth: 620, alignment: .leading)
            actionRow.padding(.top, Metrics.space2)
        }
        .padding(.horizontal, Metrics.gutter)
        // The page's section gap follows, so only a small inset here.
        .padding(.bottom, Metrics.space2)
    }
    #endif
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
                if isCurrent { Text("Up Next").eyebrowStyle(Theme.accentText).padding(.bottom, 2) }
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
