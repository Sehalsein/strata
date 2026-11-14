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
    /// IMDb / Rotten Tomatoes, after the metadata line.
    let ratings: [ExternalRating]
    let overview: String?
    /// A page of a horizontal pager: the art slides at a slower pace than the page.
    let paged: Bool
    /// Home's featured layout on Apple TV and iPad, like the TV app's: the text to the
    /// left over a darker wash, the eyebrow as a pill, and on the TV the art running on
    /// under the first rail, which peeks in at the bottom of the screen.
    let featured: Bool
    /// "Starring …", "Director …": at the bottom right of the featured layout.
    let credits: [HeroCredit]
    @ViewBuilder let actions: () -> Actions
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(id: String, backdropURL: URL?, fallbackURL: URL? = nil, eyebrow: String? = nil, title: String, meta: [String] = [], badges: [String] = [], ratings: [ExternalRating] = [], overview: String? = nil, paged: Bool = false, featured: Bool = false, credits: [HeroCredit] = [], @ViewBuilder actions: @escaping () -> Actions) {
        self.id = id
        // Full size: list-sized TMDB art (w780) is soft across a whole screen.
        self.backdropURL = backdropURL.map(TMDBImage.original)
        self.paged = paged
        self.featured = featured
        self.credits = credits
        self.fallbackURL = fallbackURL
        self.eyebrow = eyebrow
        self.title = title
        self.meta = meta
        self.badges = badges
        self.ratings = ratings
        self.overview = overview
        self.actions = actions
    }

    #if os(tvOS)
    private static var backdropPixels: Int { 1920 }
    #else
    // The art fills the hero's height, so on a 3x phone it's ~2,800px wide.
    private static var backdropPixels: Int { 2400 }
    #endif

    /// How far the art lags behind a page as it slides, as a fraction of the page width.
    private static var pageParallax: CGFloat { 0.3 }
    /// How fast the art moves as the page scrolls up, relative to the page.
    private static var scrollParallax: CGFloat { 0.45 }

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
            if !bleedsUnderRail { art }
            if usesFeaturedLayout {
                featuredInfo
                    .frame(maxWidth: .infinity, alignment: .bottomLeading)
                    .overlay(alignment: .bottomTrailing) { creditsBlock }
            } else {
                #if os(tvOS)
                tvInfo
                #else
                info
                #endif
            }
        }
        // Full width even when the art is in the background and only the text is inside.
        .frame(maxWidth: .infinity, alignment: .bottomLeading)
        .frame(height: frameHeight, alignment: .bottom)
        // The featured TV hero is shorter than the screen so the first rail shows below
        // it, and its art carries on under that rail to the bottom of the screen.
        .background(alignment: .top) {
            if bleedsUnderRail { art.frame(height: Self.screenHeight) }
        }
    }

    private var art: some View {
        ZStack {
            backdrop
            ZStack { scrims }
                .visualEffect { [stretches] content, proxy in
                    // Pulled down, the shades stretch with the art, so the top one doesn't
                    // stop in a hard line partway up the stretched picture.
                    let y = stretches ? proxy.frame(in: .scrollView(axis: .vertical)).minY : 0
                    let height = max(proxy.size.height, 1)
                    return content.scaleEffect(y > 0 ? (height + y) / height : 1, anchor: .bottom)
                }
                .allowsHitTesting(false)
        }
    }

    #if os(tvOS)
    private static var screenHeight: CGFloat { UIScreen.main.bounds.height }
    #else
    private static var screenHeight: CGFloat { 0 }
    #endif

    /// The left-weighted layout: Home's featured carousel on Apple TV and iPad.
    private var usesFeaturedLayout: Bool { featured && Metrics.isPadOrTV }

    /// The TV's featured hero leaves the bottom of the screen to the first rail.
    private var bleedsUnderRail: Bool {
        #if os(tvOS)
        featured
        #else
        false
        #endif
    }

    private var frameHeight: CGFloat {
        #if os(tvOS)
        // Like the TV app: the art fills the whole screen, safe areas included; on Home
        // the first rail's title and the top of its cards show at the bottom.
        featured ? (Self.screenHeight * 0.76).rounded() : Self.screenHeight
        #else
        usesFeaturedLayout ? 720 : height
        #endif
    }

    /// Whether the art stretches into a pulled-down page (and the shades with it).
    private var stretches: Bool {
        #if os(iOS)
        !reduceMotion
        #else
        false
        #endif
    }

    /// The backdrop; without one, the poster blurred to fill; without either, a
    /// full-bleed placeholder. Whichever it is runs to the top edge of the page.
    private var backdrop: some View {
        let blurred = backdropURL == nil
        #if os(iOS)
        let moves = !reduceMotion
        #else
        let moves = false
        #endif
        // The container sets the size and the image fills it as an overlay: an
        // aspect-fill image laid out directly would widen the page past the screen.
        return Color.clear
            .overlay {
                GeometryReader { geo in
                    // In a pager the art is wider than the page, so it can slide within it.
                    let bleed = paged && moves ? (geo.size.width * Self.pageParallax).rounded() : 0
                    // A blurred poster needs few pixels; a backdrop, about the screen's width.
                    RemoteImage(url: backdropURL ?? fallbackURL, maxPixel: blurred ? 320 : Self.backdropPixels, blur: blurred ? 40 : 0) {
                        StrataPlaceholder.hero(seed: id)
                    }
                    .frame(width: geo.size.width + 2 * bleed, height: geo.size.height)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .visualEffect { [paged, moves, pageParallax = Self.pageParallax, scrollParallax = Self.scrollParallax] content, proxy in
                        // Like the TV app: the art lags behind as the page slides or scrolls
                        // up, and stretches to fill the gap when the page is pulled down.
                        let x = paged && moves ? proxy.frame(in: .scrollView(axis: .horizontal)).minX : 0
                        let y = moves ? proxy.frame(in: .scrollView(axis: .vertical)).minY : 0
                        let height = max(proxy.size.height, 1)
                        return content
                            .offset(x: -x * pageParallax, y: y < 0 ? -y * scrollParallax : 0)
                            .scaleEffect(y > 0 ? (height + y) / height : 1, anchor: .bottom)
                    }
                }
            }
            // Open at the top so the stretched art can run up into a pulled-down page.
            .clipShape(OpenTopRectangle())
            .accessibilityHidden(true)
    }

    @ViewBuilder private var scrims: some View {
        if usesFeaturedLayout {
            // Like the TV app: a deep wash from the left edge, under the text, so the
            // right of the picture stays bright.
            LinearGradient(stops: Self.eased(from: 0, to: 0.62) { (colorScheme == .light ? Theme.bg : .black).opacity(0.78 * (1 - $0)) },
                           startPoint: .leading, endPoint: .trailing)
        }
        #if os(tvOS)
        // A left-side wash keeps the title legible over bright art; it sits under
        // the bottom fade so the hero ends in plain `bg` with no seam.
        LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .leading, endPoint: .center)
        #else
        // Under the status bar and navigation bar: a soft shade so they read over the
        // art, standing in for the bar's edge effect, which `heroUnderBar()` hides
        // while the page is at the top (it cuts a hard band across the art).
        LinearGradient(stops: Self.eased(from: 0, to: 0.3) { (colorScheme == .light ? Theme.bg : .black).opacity(0.45 * (1 - $0)) },
                       startPoint: .top, endPoint: .bottom)
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
            if !meta.isEmpty || !badges.isEmpty || !ratings.isEmpty {
                // One line when it fits; on a phone the badges wrap under the metadata.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Metrics.space2) {
                        metaText
                        badgeRow
                    }
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        metaText
                        badgeRow
                    }
                }
            }
        }
    }

    @ViewBuilder private var metaText: some View {
        if !meta.isEmpty {
            Text(meta.joined(separator: " · ")).font(.stCallout).foregroundStyle(heroText.opacity(0.8))
        }
    }

    @ViewBuilder private var badgeRow: some View {
        if !ratings.isEmpty || !badges.isEmpty {
            HStack(spacing: Metrics.space2) {
                ForEach(ratings, id: \.self) { RatingBadge($0) }
                ForEach(badges, id: \.self) { SpecBadge($0) }
            }
        }
    }

    private var actionRow: some View {
        // The featured hero spaces its buttons out like the TV app's.
        GlassEffectContainer(spacing: Metrics.space2) {
            HStack(spacing: usesFeaturedLayout ? Metrics.space6 : Metrics.space3) { actions() }
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
    private let featuredWidth: CGFloat = 1100
    private let featuredOverviewWidth: CGFloat = 760
    private let featuredTitleFont = Font.system(size: 68, weight: .heavy)
    private let featuredBottom: CGFloat = Metrics.space12
    #else
    private let featuredWidth: CGFloat = 640
    private let featuredOverviewWidth: CGFloat = 460
    private let featuredTitleFont = Font.system(size: 52, weight: .heavy)
    private let featuredBottom: CGFloat = Metrics.space10
    #endif

    /// The featured layout's text: eyebrow pill, title, metadata, a short overview, then
    /// the actions, all to the left like the TV app's.
    private var featuredInfo: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            if let eyebrow {
                Text(eyebrow)
                    .font(.stFootnote.weight(.semibold))
                    .foregroundStyle(heroText)
                    .padding(.horizontal, Metrics.space3)
                    .padding(.vertical, Metrics.space1)
                    .overlay(Capsule().strokeBorder(heroText.opacity(0.7), lineWidth: 2))
            }
            Text(title)
                .font(featuredTitleFont)
                .titleTracking()
                .foregroundStyle(heroText)
                .lineLimit(2)
                .minimumScaleFactor(0.5)
                .shadow(color: .black.opacity(colorScheme == .light ? 0 : 0.35), radius: 12, y: 4)
                .accessibilityAddTraits(.isHeader)
            // Like the TV app: the facts, the synopsis, then the ratings and specs.
            if !meta.isEmpty {
                Text(meta.joined(separator: " · "))
                    .font(.stCallout.weight(.semibold))
                    .foregroundStyle(heroText.opacity(0.9))
                    .lineLimit(1)
            }
            if let overview, !overview.isEmpty {
                Text(overview)
                    .font(.stCallout)
                    .foregroundStyle(heroText.opacity(0.85))
                    .lineLimit(3)
                    .frame(maxWidth: featuredOverviewWidth, alignment: .leading)
            }
            badgeRow
            actionRow.padding(.top, Metrics.space3)
        }
        .frame(maxWidth: featuredWidth, alignment: .leading)
        .padding(.horizontal, Metrics.gutter)
        .padding(.bottom, featuredBottom)
    }

    #if os(tvOS)
    /// The credits, quiet, at the bottom right (the TV app's "Starring" and "Director").
    @ViewBuilder private var creditsBlock: some View {
        if Metrics.isTV, !credits.isEmpty {
            VStack(alignment: .leading, spacing: Metrics.space1) {
                ForEach(credits, id: \.label) { credit in
                    (Text(credit.label + " ").foregroundStyle(heroText.opacity(0.6))
                     + Text(credit.names).foregroundStyle(heroText.opacity(0.9)))
                        .font(.stFootnote)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: 480, alignment: .leading)
            .padding(.trailing, Metrics.gutter)
            .padding(.bottom, featuredBottom)
            .accessibilityElement(children: .combine)
        }
    }

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
    /// The credits show on the TV only.
    private var creditsBlock: some View { EmptyView() }

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

/// A line of credits for the hero: "Starring" and the first few names.
public struct HeroCredit: Hashable, Sendable {
    public let label: String
    public let names: String
    public init(_ label: String, _ names: [String]) {
        self.label = label
        self.names = names.joined(separator: ", ")
    }
}

/// A rectangle with no top edge: clips the sides and bottom, and lets content run up
/// past the top (hero art stretching into a pulled-down page).
public struct OpenTopRectangle: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        Path(CGRect(x: rect.minX, y: rect.minY - 10_000, width: rect.width, height: rect.height + 10_000))
    }
}

/// TMDB image URLs carry their size in the path (`/t/p/w780/…`).
public enum TMDBImage {
    /// The full-size image, for art that fills the screen. Other URLs are left as they are.
    public static func original(_ url: URL) -> URL {
        guard url.host() == "image.tmdb.org" else { return url }
        let path = url.absoluteString.replacingOccurrences(of: #"/t/p/w\d+/"#, with: "/t/p/original/", options: .regularExpression)
        return URL(string: path) ?? url
    }
}

/// The shape of a `HeroBillboard` while its page loads: same height, with bars where
/// the eyebrow, title, metadata, overview and buttons will be, so nothing moves when
/// the page arrives.
public struct SkeletonHero: View {
    public init() {}

    #if os(tvOS)
    private let titleSize = CGSize(width: 720, height: 76)
    private let button = CGSize(width: 220, height: 66)
    #else
    private var height: CGFloat { Metrics.isPad ? 620 : 520 }
    private let titleSize = CGSize(width: 240, height: 36)
    private let button = CGSize(width: 120, height: 50)
    #endif

    public var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [Theme.surface1, Theme.surface1, Theme.bg], startPoint: .top, endPoint: .bottom)
            info
        }
        #if os(tvOS)
        .frame(height: UIScreen.main.bounds.height)
        #else
        .frame(height: height)
        #endif
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            SkeletonBar(width: 80, height: 12)
            SkeletonBar(width: titleSize.width, height: titleSize.height)
            SkeletonBar(width: 200, height: 14)
            VStack(alignment: .leading, spacing: 6) {
                SkeletonBar(height: 13)
                SkeletonBar(height: 13)
                SkeletonBar(width: 180, height: 13)
            }
            .frame(maxWidth: 620, alignment: .leading)
            HStack(spacing: Metrics.space3) {
                Capsule().fill(Theme.surface2).frame(width: button.width, height: button.height)
                Circle().fill(Theme.surface2).frame(width: button.height, height: button.height)
            }
            .padding(.top, Metrics.space2)
        }
        .padding(.horizontal, Metrics.gutter)
        #if os(tvOS)
        .padding(.bottom, Metrics.space20)
        #else
        .padding(.bottom, Metrics.space2)
        #endif
        .skeletonPulse()
    }
}

/// Episode-row-shaped placeholders for a season that's loading.
public struct SkeletonEpisodeRows: View {
    let count: Int
    public init(count: Int = 4) { self.count = count }

    #if os(tvOS)
    private let stillWidth: CGFloat = 320
    #else
    private var stillWidth: CGFloat { Metrics.isPad ? 220 : 140 }
    #endif

    public var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { _ in
                HStack(alignment: .top, spacing: Metrics.space4) {
                    RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous)
                        .fill(Theme.surface1)
                        .frame(width: stillWidth)
                        .aspectRatio(16 / 9, contentMode: .fit)
                    VStack(alignment: .leading, spacing: 6) {
                        SkeletonBar(width: 160, height: 15)
                        SkeletonBar(height: 12)
                        SkeletonBar(width: 70, height: 11)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, Metrics.space3)
                .padding(.horizontal, Metrics.space4)
            }
        }
        .skeletonPulse()
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

/// One episode in a season list.
public struct EpisodeRow<Trailing: View>: View {
    let id: String
    let number: Int
    let title: String
    let overview: String?
    let foot: String?
    /// The episode's IMDb rating, beside the foot line.
    let imdbRating: Double?
    let stillURL: URL?
    let progress: Double?
    let isCurrent: Bool
    @ViewBuilder let trailing: () -> Trailing

    public init(id: String, number: Int, title: String, overview: String?, foot: String?, imdbRating: Double? = nil, stillURL: URL?, progress: Double?, isCurrent: Bool = false, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.id = id
        self.number = number
        self.title = title
        self.overview = overview
        self.foot = foot
        self.imdbRating = imdbRating
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
                if foot != nil || imdbRating != nil {
                    HStack(spacing: Metrics.space2) {
                        if let foot { Text(foot).font(.stFootnote).foregroundStyle(Theme.ink3) }
                        if let imdbRating { RatingBadge(.imdb(imdbRating)) }
                    }
                    .padding(.top, imdbRating != nil ? 2 : 0)
                }
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
    static var isTV: Bool {
        #if os(tvOS)
        true
        #else
        false
        #endif
    }

    /// The hero's buttons: a size down on the TV, so the title and text lead.
    static var heroControlSize: ControlSize { isTV ? .regular : .large }

    @MainActor static var isPadOrTV: Bool {
        #if os(tvOS)
        true
        #else
        isPad
        #endif
    }
}
