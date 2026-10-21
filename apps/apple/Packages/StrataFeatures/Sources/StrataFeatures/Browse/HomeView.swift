import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct HomeView: View {
    @Environment(AppServices.self) private var services
    @State private var shelves: Loadable<[Shelf]> = .loading

    var body: some View {
        ScrollView {
            PageStack {
                switch shelves {
                case .loading:
                    SkeletonRail(aspectRatio: 16 / 9, width: Metrics.landscapeWidth)
                    SkeletonRail(width: Metrics.posterWidth)
                case .failed(let message):
                    MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load Home", message: message, actionTitle: "Try Again") {
                        Task { await load(force: true) }
                    }
                    .frame(minHeight: 400)
                case .loaded(let list):
                    if let featured = list.first(where: { $0.id == "featured" }), !featured.items.isEmpty {
                        HeroCarousel(cards: featured.items)
                    } else {
                        #if os(tvOS)
                        Color.clear.frame(height: 120) // clear the top tab bar when there's no hero
                        #endif
                    }
                    if list.isEmpty {
                        MessageView(systemImage: "film.stack", title: "Nothing here yet",
                                    message: "Add media folders in your server's dashboard.")
                            .frame(minHeight: 400)
                    }
                    ForEach(list.filter { $0.id != "featured" }) { shelf in ShelfRail(shelf: shelf) }
                }
            }
            .padding(.bottom, Metrics.space12)
        }
        // The hero runs to the top edge, under the bar, like a title page.
        .ignoresSafeArea(edges: hasHero ? .top : [])
        #if !os(tvOS)
        .navigationTitle("Home")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: Route.myList) { Label("My List", systemImage: "bookmark") }
            }
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) { ProfileToolbarButton() }
        }
        .refreshable { await load(force: true) }
        #endif
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .task { await load(force: false) }
        .onChange(of: services.progressRevision) { Task { await load(force: false) } }
    }

    private var hasHero: Bool {
        #if os(tvOS)
        true // the top tab bar floats over the page either way
        #else
        shelves.value?.contains { $0.id == "featured" && !$0.items.isEmpty } ?? false
        #endif
    }

    private func load(force: Bool) async {
        if force { await services.client?.clearCache() }
        let result = await services.load { try await $0.home() }
        if case .loading = result { return }
        shelves = result
    }
}

/// The vertical stack of a page of rails. Lazy on iPhone and iPad; not on tvOS, where
/// the hero fills the screen: a lazy stack wouldn't build anything below it, leaving
/// the focus engine nowhere to go when you press down.
struct PageStack<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        #if os(tvOS)
        VStack(alignment: .leading, spacing: Metrics.railGap, content: content)
        #else
        LazyVStack(alignment: .leading, spacing: Metrics.railGap, content: content)
        #endif
    }
}

/// One server shelf as a rail of the right card type.
struct ShelfRail: View {
    @Environment(AppServices.self) private var services
    let shelf: Shelf

    var body: some View {
        Rail(shelf.title) {
            ForEach(shelf.items) { card in
                if shelf.kind == .continue {
                    ContinueCard(id: card.id,
                                 overline: card.episode?.code ?? card.yearText,
                                 title: card.episode?.name ?? card.title,
                                 subtitle: card.episode != nil ? card.title : card.remainingText,
                                 imageURL: card.episode?.stillUrl ?? card.backdropUrl,
                                 artworkTitle: card.title,
                                 progress: card.progressFraction,
                                 width: Metrics.landscapeWidth) {
                        if let request = card.watchRequest() { services.play(request) }
                    }
                    .contextMenu {
                        NavigationLink(value: card.route) { Label(card.type == .show ? "Go to Show" : "Go to Movie", systemImage: "info.circle") }
                        Button { if let r = card.watchRequest(restart: true) { services.play(r) } } label: { Label("Play from Beginning", systemImage: "arrow.counterclockwise") }
                        if let target = card.watchRequest()?.target {
                            Button { setWatched(target, true) } label: { Label("Mark as Watched", systemImage: "checkmark.circle") }
                        }
                        // Off the rail until it's watched again; progress is kept.
                        Button(role: .destructive) { hide(card) } label: {
                            Label(shelf.id == "nextUp" ? "Remove from Next Up" : "Remove from Continue Watching", systemImage: "minus.circle")
                        }
                    }
                } else {
                    NavigationLink(value: card.route) {
                        PosterCardLabel(card: card)
                    }
                    .buttonStyle(StrataCardStyle())
                }
            }
            // My List lives on Home now: its rail ends in the full list.
            if shelf.id == "watchlist" {
                NavigationLink(value: Route.myList) { SeeAllTile() }.buttonStyle(StrataCardStyle())
            }
        }
    }

    private func hide(_ card: TitleCard) {
        Task {
            _ = await services.load { try await $0.hideFromContinue(card.type, tmdbId: card.tmdbId) }
            await services.progressChanged()
        }
    }

    /// Watched marks the item done, so it leaves the rail.
    private func setWatched(_ target: PlaybackTarget, _ watched: Bool) {
        Task {
            _ = await services.load { try await $0.setWatched(target, watched) }
            await services.progressChanged()
        }
    }
}

/// Poster artwork and caption for a title, for use inside a NavigationLink.
struct PosterCardLabel: View {
    let card: TitleCard
    /// Fixed width in rails; `nil` fills the cell in a grid.
    var width: CGFloat? = Metrics.posterWidth

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            // No title on the placeholder: the caption below already names it.
            ArtworkImage(url: card.posterUrl, aspectRatio: 2 / 3, seed: card.id)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                // On a person's page the role ("Tony Lip", "Director") says more than the year.
                if let caption = card.role.map({ [$0, card.yearText].compactMap { $0 }.joined(separator: " · ") }) ?? card.yearText {
                    Text(caption).font(.stFootnote).foregroundStyle(Theme.ink3).lineLimit(1)
                }
            }
            #if os(tvOS)
            .opacity(0.9)
            #endif
        }
        .frame(width: width)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([card.title, card.yearText, card.providerKinds.first.map { "on \($0.label)" }].compactMap { $0 }.joined(separator: ", "))
    }
}

/// The Home hero: a carousel of featured titles (recently added, trending movies,
/// shows and anime) that moves on by itself. iPhone and iPad swipe between them;
/// on tvOS, moving left or right past the hero's buttons does.
struct HeroCarousel: View {
    @Environment(AppServices.self) private var services
    let cards: [TitleCard]
    @State private var index = 0
    /// Only moves on while it's on screen and the app is active (Home stays alive under
    /// other tabs and pushed pages).
    @State private var visible = false
    @Environment(\.scenePhase) private var scenePhase
    #if os(tvOS)
    @FocusState private var focus: HeroButton?
    enum HeroButton: Hashable { case play, info }
    #endif

    private static let interval: Double = 8

    private struct AdvanceKey: Equatable {
        let index: Int
        let running: Bool
    }

    private var running: Bool {
        #if os(tvOS)
        // Not while someone's on Play or More Info: the title would change under them.
        visible && scenePhase == .active && focus == nil
        #else
        visible && scenePhase == .active
        #endif
    }

    var body: some View {
        // On the TV the dots sit over the art; on iPhone and iPad, in their own row under
        // the buttons, with room to breathe.
        #if os(tvOS)
        let stack = content.overlay(alignment: .bottom) { dots }
        #else
        let stack = VStack(spacing: Metrics.space5) { content; dots }
        #endif
        stack
            .onChange(of: cards.count) { if index >= cards.count { index = 0 } }
            .onAppear { visible = true }
            .onDisappear { visible = false }
            // Restarts on every change, manual or not, so a swipe gets a full interval.
            .task(id: AdvanceKey(index: index, running: running)) {
                guard running else { return }
                try? await Task.sleep(for: .seconds(Self.interval))
                guard !Task.isCancelled, cards.count > 1 else { return }
                withAnimation(.easeInOut(duration: 0.6)) { index = (index + 1) % cards.count }
            }
    }

    #if os(tvOS)
    private var content: some View {
        hero(cards[min(index, cards.count - 1)])
            .id(index)
            .transition(.opacity)
            .focusSection()
            .onMoveCommand { direction in
                // Past the last button goes to the next title, before the first to the previous one.
                let last: HeroButton = .info
                let first: HeroButton = hasPlay(cards[index]) ? .play : .info
                if direction == .right, focus == last { step(1) }
                if direction == .left, focus == first { step(-1) }
            }
    }

    private func step(_ by: Int) {
        let keep = focus
        withAnimation(.easeInOut(duration: 0.4)) { index = (index + by + cards.count) % cards.count }
        // The new title's buttons replace the old ones: keep focus on the same kind.
        DispatchQueue.main.async { focus = hasPlay(cards[index]) ? keep : .info }
    }
    #elseif os(iOS)
    private var content: some View {
        TabView(selection: $index) {
            // Identity follows the title, so a reload doesn't rebuild every page.
            ForEach(Array(cards.enumerated()), id: \.element.id) { i, card in
                hero(card).tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(height: Metrics.isPad ? 620 : 520)
    }
    #else
    private var content: some View { hero(cards[min(index, cards.count - 1)]) }
    #endif

    /// Movies in the server's library get Play; everything else, More Info only.
    private func hasPlay(_ card: TitleCard) -> Bool { card.type == .movie && card.isAvailable }

    private func hero(_ card: TitleCard) -> some View {
        // Just the name: the carousel is for picking, the title page has the details.
        HeroBillboard(id: card.id, backdropURL: card.backdropUrl, fallbackURL: card.posterUrl, eyebrow: card.eyebrow, title: card.title) {
            // Only what's in the server's library plays; the rest is for browsing.
            if hasPlay(card) {
                PlayButton("Play") {
                    services.play(WatchRequest(target: .movie(card.tmdbId), meta: PlaybackMeta(title: card.title, subtitle: card.yearText, artworkURL: card.backdropUrl)))
                }
                #if os(tvOS)
                .focused($focus, equals: .play)
                #endif
            }
            // Ink, not the accent: glass labels take the tint, and apricot means Play.
            // Sized like PlayButton (large control, 30pt label) so the two line up.
            NavigationLink(value: card.route) {
                Label("More Info", systemImage: "info.circle").font(.stHeadline).frame(minHeight: 30)
            }
                .buttonStyle(.glass)
                .controlSize(.large)
                .tint(Theme.ink)
                #if os(tvOS)
                .focused($focus, equals: .info)
                #endif
        }
    }

    /// Over the art on the TV; on the page (light or dark) on iPhone and iPad.
    #if os(tvOS)
    private let dotColor = Theme.onArtwork
    #else
    private let dotColor = Theme.ink
    #endif

    @ViewBuilder private var dots: some View {
        if cards.count > 1 {
            HStack(spacing: 6) {
                ForEach(cards.indices, id: \.self) { i in
                    Capsule()
                        .fill(dotColor.opacity(i == index ? 0.9 : 0.35))
                        .frame(width: i == index ? 18 : 6, height: 6)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: index)
            #if os(tvOS)
            .padding(.bottom, Metrics.space8)
            #endif
            .accessibilityElement()
            .accessibilityLabel("Featured \(index + 1) of \(cards.count)")
        }
    }
}
