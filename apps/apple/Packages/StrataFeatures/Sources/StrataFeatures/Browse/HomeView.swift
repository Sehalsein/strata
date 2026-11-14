import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct HomeView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.showsSidebar) private var showsSidebar
    /// The rails that are the same for everyone, kept on this device (see `loadCached`).
    @State private var catalog: Loadable<[Shelf]> = .loading
    /// Continue Watching, Up Next and My List: asked for on every visit, never kept.
    @State private var mine: [Shelf] = []
    @State private var upcoming: [CalendarEpisode] = []

    /// The hero, then the account's rails, then the catalog's.
    private var shelves: Loadable<[Shelf]> {
        guard case .loaded(let list) = catalog else { return catalog }
        return .loaded(list.filter { $0.id == "featured" } + mine + list.filter { $0.id != "featured" })
    }

    var body: some View {
        ScrollView {
            PageStack {
                switch shelves {
                case .loading:
                    SkeletonHero(featured: true)
                    SkeletonRail(aspectRatio: 16 / 9, width: Metrics.landscapeWidth)
                    SkeletonRail(width: Metrics.posterWidth)
                case .failed(let message):
                    MessageView(systemImage: "wifi.exclamationmark", title: String(localized: "Couldn't load Home", bundle: .module), message: message, actionTitle: String(localized: "Try Again", bundle: .module)) {
                        Task { await load(force: true) }
                    }
                    .frame(minHeight: 400)
                case .loaded(let list):
                    if let featured = list.first(where: { $0.id == "featured" }), !featured.items.isEmpty {
                        HeroCarousel(cards: featured.items, watchlist: watchlistKeys(list), takesLaunchFocus: true)
                    } else {
                        #if os(tvOS)
                        Color.clear.frame(height: 120) // clear the sidebar button when there's no hero
                        #endif
                    }
                    if list.isEmpty {
                        MessageView(systemImage: "film.stack", title: String(localized: "Nothing here yet", bundle: .module),
                                    message: String(localized: "Add media folders in your server's dashboard.", bundle: .module))
                            .frame(minHeight: 400)
                    }
                    ForEach(Self.rails(list)) { shelf in
                        ShelfRail(shelf: shelf)
                        // What's airing soon for shows on My List, after the list itself.
                        if shelf.id == Self.comingUpAfter(list) { ComingUpRail(episodes: upcoming) }
                    }
                    if Self.comingUpAfter(list) == nil { ComingUpRail(episodes: upcoming) }
                }
            }
            .padding(.bottom, Metrics.space12)
        }
        // The hero runs to the top edge, under the bar, like a title page.
        .heroUnderBar(hasHero)
        #if !os(tvOS)
        .navigationTitle(Text("Home", bundle: .module))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            // With the iPad sidebar, My List and the profile are there.
            if !showsSidebar {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink(value: Route.myList) { Label(String(localized: "My List", bundle: .module), systemImage: "bookmark") }
                }
            }
            ProfileToolbarItems()
        }
        .refreshable { await load(force: true); await loadUpcoming() }
        #endif
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .task { await load(force: false) }
        .task { await loadUpcoming() }
        .onChange(of: services.progressRevision) { Task { await loadMine(); await loadUpcoming() } }
    }

    /// The rails under the hero. Continue Watching and Next Up are one rail, like the TV
    /// app's: what you're partway through, then the next episode of what you finished.
    private static func rails(_ list: [Shelf]) -> [Shelf] {
        let resume = list.filter { $0.id == "continue" || $0.id == "nextUp" }
        var rails = list.filter { $0.id != "featured" }
        guard let first = rails.firstIndex(where: { resume.map(\.id).contains($0.id) }) else { return rails }
        rails.removeAll { resume.map(\.id).contains($0.id) }
        rails.insert(Shelf(id: "continue", title: String(localized: "Continue Watching", bundle: .module), kind: .continue, items: resume.flatMap(\.items)), at: first)
        return rails
    }

    /// The rail Coming Up follows: My List, else Continue Watching; `nil` puts it first.
    private static func comingUpAfter(_ list: [Shelf]) -> String? {
        let ids = rails(list).map(\.id)
        return ids.contains("watchlist") ? "watchlist" : ids.contains("continue") ? "continue" : nil
    }

    private func watchlistKeys(_ list: [Shelf]) -> Set<String> {
        Set(list.first { $0.id == "watchlist" }?.items.map(\.ref.description) ?? [])
    }

    /// Episodes airing from today on; the rail stays hidden if the calendar can't load.
    private func loadUpcoming() async {
        guard let client = services.client, let all = try? await client.calendar() else { return }
        let today = Calendar.current.startOfDay(for: .now)
        upcoming = Array(all.filter { $0.date >= today }.sorted { $0.date < $1.date }.prefix(20))
    }

    private var hasHero: Bool {
        #if os(tvOS)
        true // the sidebar button floats over the page either way
        #else
        shelves.value?.contains { $0.id == "featured" && !$0.items.isEmpty } ?? false
        #endif
    }

    private func load(force: Bool) async {
        async let profile: Void = loadMine()
        await services.loadCached(force: force, { try await $0.homeCatalog($1) }) { catalog = $0 }
        await profile
    }

    private func loadMine() async {
        if let list = await services.load({ try await $0.homeProfile() }).value { mine = list }
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

/// One server shelf as a rail of the right card type. A rail of titles shows the first
/// `Metrics.railLimit`; the rest (or the bigger list behind it) are behind its title's "›".
struct ShelfRail: View {
    @Environment(AppServices.self) private var services
    @Environment(\.pushRoute) private var pushRoute
    let shelf: Shelf

    var body: some View {
        Rail(shelf.title, link: seeAll) {
            ForEach(shelf.kind == .continue ? shelf.items : Array(shelf.items.prefix(Metrics.railLimit))) { card in
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
                        // A Button, not a NavigationLink: menu items sit outside the stack.
                        Button { pushRoute(card.route) } label: { Label(card.type == .show ? "Go to Show" : "Go to Movie", systemImage: "info.circle") }
                        Button { if let r = card.watchRequest(restart: true) { services.play(r) } } label: { Label(String(localized: "Play from Beginning", bundle: .module), systemImage: "arrow.counterclockwise") }
                        if let target = card.watchRequest()?.target {
                            Button { setWatched(target, true) } label: { Label(String(localized: "Mark as Watched", bundle: .module), systemImage: "checkmark.circle") }
                        }
                        // Off the rail until it's watched again; progress is kept.
                        Button(role: .destructive) { hide(card) } label: {
                            Label(String(localized: "Remove from Continue Watching", bundle: .module), systemImage: "minus.circle")
                        }
                    }
                } else {
                    NavigationLink(value: card.route) {
                        PosterCardLabel(card: card)
                    }
                    .cardButtonStyle()
                }
            }
        }
    }

    /// Where the title's "›" goes: My List (it lives on Home now), the server's full list, or a
    /// grid of what this shelf has past the rail.
    private var seeAll: Route? {
        guard shelf.kind == .titles else { return nil }
        if shelf.id == "watchlist" { return .myList }
        if let more = shelf.more { return .animeList(more, shelf.title) }
        return shelf.items.count > Metrics.railLimit ? .shelf(shelf) : nil
    }

    private func hide(_ card: TitleCard) {
        Task { try? await services.titles.hideFromContinue(card.ref) }
    }

    /// Watched marks the item done, so it leaves the rail.
    private func setWatched(_ target: PlaybackTarget, _ watched: Bool) {
        Task { try? await services.titles.setWatched(target, watched) }
    }
}

/// Poster artwork and caption for a title, for use inside a NavigationLink.
struct PosterCardLabel: View {
    let card: TitleCard
    /// Fixed width in rails; `nil` fills the cell in a grid.
    var width: CGFloat? = Metrics.posterWidth

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.cardCaptionGap) {
            // No title on the placeholder: the caption below already names it.
            ArtworkImage(url: card.posterUrl, aspectRatio: 2 / 3, seed: card.id)
                .overlay(alignment: .bottomLeading) {
                    // The server's label ("Episode 12"), on the art.
                    if let badge = card.badge {
                        Text(badge)
                            .font(.stFootnote.weight(.semibold))
                            .foregroundStyle(Theme.onArtwork)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.black.opacity(0.55), in: Capsule())
                            .padding(Metrics.space2)
                    }
                }
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
        // One element: the title, then what the caption and the badge say.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.title)
        .accessibilityValue([card.role, card.yearText, card.badge, card.providerKinds.first.map { String(localized: "on \($0.label)", bundle: .module) }]
            .compactMap { $0 }.joined(separator: ", "))
    }
}

/// Upcoming episodes of shows on My List, soonest first; the title opens the Calendar.
struct ComingUpRail: View {
    @Environment(\.pushRoute) private var pushRoute
    let episodes: [CalendarEpisode]

    var body: some View {
        if !episodes.isEmpty {
            Rail(String(localized: "Upcoming Episodes", bundle: .module), seeAll: { pushRoute(.calendar) }) {
                ForEach(episodes) { episode in
                    NavigationLink(value: Route.title(episode.ref)) { ComingUpCard(episode: episode) }
                        .cardButtonStyle()
                }
            }
        }
    }
}

private struct ComingUpCard: View {
    let episode: CalendarEpisode

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.cardCaptionGap) {
            ArtworkImage(url: episode.backdropUrl, aspectRatio: 16 / 9, seed: episode.ref.description,
                         title: episode.backdropUrl == nil ? episode.title : nil)
            VStack(alignment: .leading, spacing: 2) {
                Text(when).eyebrowStyle(Calendar.current.isDateInToday(episode.date) ? Theme.accentText : Theme.ink3)
                Text(episode.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text([episode.code, episode.name].compactMap { $0 }.joined(separator: " · "))
                    .font(.stFootnote).foregroundStyle(Theme.ink3).lineLimit(1)
            }
        }
        .frame(width: Metrics.landscapeWidth)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// "Today 9:00 PM", "Tomorrow", "Friday".
    private var when: String {
        let calendar = Calendar.current
        let time = episode.hasTime ? " " + episode.date.formatted(date: .omitted, time: .shortened) : ""
        if calendar.isDateInToday(episode.date) { return String(localized: "Today", bundle: .module) + time }
        if calendar.isDateInTomorrow(episode.date) { return String(localized: "Tomorrow", bundle: .module) + time }
        let inWeek = episode.date < calendar.date(byAdding: .day, value: 6, to: calendar.startOfDay(for: .now))!
        return episode.date.formatted(inWeek ? .dateTime.weekday(.wide) : .dateTime.month(.abbreviated).day())
    }
}

/// The Home hero: a carousel of featured titles (recently added, trending movies,
/// shows and anime) that moves on by itself. iPhone and iPad swipe between them, and
/// tapping the art opens the title; on tvOS, the "›" button after the hero's buttons
/// moves to the next one.
struct HeroCarousel: View {
    @Environment(AppServices.self) private var services
    @Environment(\.pushRoute) private var pushRoute
    let cards: [TitleCard]
    /// The ref of each title on My List, from Home's own shelf.
    var watchlist: Set<String> = []
    /// Home's carousel takes focus when it first shows, so the app opens on Play rather
    /// than in the sidebar (which tvOS opens when nothing else can take focus while Home
    /// loads). Once per launch: later it would pull focus out of the sidebar mid-browse.
    var takesLaunchFocus = false
    @MainActor private static var tookLaunchFocus = false
    /// Taps on + not yet reflected in `watchlist`.
    @State private var listed: [String: Bool] = [:]
    /// What Play does for each title the carousel has shown, once the server has said.
    @State private var plays: [String: PlayOptions] = [:]
    @State private var index = 0
    /// Only moves on while it's on screen and the app is active: Home stays alive under
    /// other tabs and pushed pages (`onScreen`), and on the TV the page stack isn't lazy,
    /// so scrolling down to the rails doesn't take the hero away (`inView`).
    @State private var onScreen = false
    @State private var inView = true
    private var visible: Bool { onScreen && inView }
    @Environment(\.scenePhase) private var scenePhase
    /// Titles changing by themselves are hard to follow with VoiceOver and are motion.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    #if os(tvOS)
    @FocusState private var focus: HeroButton?
    enum HeroButton: Hashable { case play, add, info, next }
    /// The button you chose, which focus goes back to as titles change (Play, when the
    /// next title has one, even if the last one didn't).
    @State private var chosen: HeroButton?
    /// Where the carousel itself last put focus, so that move isn't taken as your choice.
    @State private var placed: HeroButton?
    #endif

    private static let interval: Double = 8

    private struct AdvanceKey: Hashable {
        let index: Int
        let running: Bool
    }

    /// Moves on while on screen, buttons focused or not (as the TV app's does); focus stays
    /// on the same button for the next title. Never with Reduce Motion or VoiceOver on.
    private var running: Bool { visible && scenePhase == .active && !reduceMotion && !voiceOver }

    /// iPad's roomier layout, with the facts and the synopsis; always on the TV.
    private var roomy: Bool {
        #if os(iOS)
        sizeClass == .regular
        #else
        Metrics.isPadOrTV
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
            .onChange(of: watchlist) { listed = [:] }
            .onAppear { onScreen = true }
            .onScrollVisibilityChange(threshold: 0.3) { inView = $0 }
            #if os(tvOS)
            .task {
                // Not when the app opened on a link: that page goes over Home and keeps focus.
                guard takesLaunchFocus, !Self.tookLaunchFocus, !cards.isEmpty,
                      services.coordinator.pendingRoute == nil else { return }
                Self.tookLaunchFocus = true
                // After the buttons are in place, so the focus engine can find them.
                try? await Task.sleep(for: .milliseconds(150))
                guard visible, services.coordinator.pendingRoute == nil else { return }
                // Play is the button to start on; until it's known, "+" holds focus for it.
                if focus == nil {
                    chosen = .play
                    place(hasPlay(cards[min(index, cards.count - 1)]) ? .play : .add)
                }
            }
            #endif
            .onDisappear { onScreen = false }
            // Only the title on screen: asking about all of them would send the server
            // looking for sources for ten titles at once.
            // After watching, Up Next moves on: ask again.
            .onChange(of: services.progressRevision) { plays = [:] }
            .task(id: cards.isEmpty ? nil : "\(cards[min(index, cards.count - 1)].id)|\(services.progressRevision)") {
                guard !cards.isEmpty else { return }
                await resolvePlay(cards[min(index, cards.count - 1)])
            }
            // The next title's art, so it's there when the carousel moves on.
            .onChange(of: index, initial: true) {
                guard cards.count > 1 else { return }
                let next = cards[(min(index, cards.count - 1) + 1) % cards.count]
                HeroArt.prefetch(backdropURL: next.backdropUrl, fallbackURL: next.posterUrl)
            }
            // Restarts on every change, manual or not, so a swipe gets a full interval.
            .task(id: AdvanceKey(index: index, running: running)) {
                guard running else { return }
                try? await Task.sleep(for: .seconds(Self.interval))
                guard !Task.isCancelled, cards.count > 1 else { return }
                go(1)
            }
    }

    /// The next or previous title: the timer, the TV's "›" button, and VoiceOver's swipe
    /// up and down on the dots.
    private func go(_ by: Int) {
        guard cards.count > 1 else { return }
        #if os(tvOS)
        step(by)
        #else
        withAnimation(.easeInOut(duration: 0.6)) { index = (index + by + cards.count) % cards.count }
        #endif
    }

    #if os(tvOS)
    private var content: some View {
        hero(cards[min(index, cards.count - 1)])
            .id(index)
            .transition(.opacity)
            .focusSection()
            .background(trackChoice())
    }

    private func step(_ by: Int) {
        // Only while focus is in the hero; from the rows below, it stays where it is.
        let want = focus == nil ? nil : (chosen ?? focus)
        withAnimation(.easeInOut(duration: 0.4)) { index = (index + by + cards.count) % cards.count }
        // The new title's buttons replace the old ones: focus the same kind.
        DispatchQueue.main.async { if let want { place(want == .play && !hasPlay(cards[index]) ? .add : want) } }
    }

    private func place(_ button: HeroButton) {
        placed = button
        focus = button
    }

    /// Remembers the button you moved to, and puts you back on Play once the title on
    /// screen turns out to have one.
    private func trackChoice() -> some View {
        Color.clear
            .onChange(of: focus) { _, new in
                guard let new else { return }
                if new == placed { placed = nil } else { chosen = new }
            }
            .onChange(of: plays) {
                if chosen == .play, focus == .add, hasPlay(cards[min(index, cards.count - 1)]) { place(.play) }
            }
    }
    #elseif os(iOS)
    private var content: some View {
        // A paging scroll view rather than a page TabView, so each page's art can lag
        // behind it as it slides (see HeroBillboard's `paged`).
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                // Identity follows the title, so a reload doesn't rebuild every page.
                ForEach(Array(cards.enumerated()), id: \.element.id) { i, card in
                    hero(card)
                        .containerRelativeFrame(.horizontal)
                        .contentShape(Rectangle())
                        .onTapGesture { pushRoute(card.route) }
                        .accessibilityAction(named: card.type == .movie ? Text("Go to Movie", bundle: .module) : Text("Go to Show", bundle: .module)) { pushRoute(card.route) }
                        .id(i)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: Binding(get: { index }, set: { if let i = $0 { index = i } }))
        // A horizontal pager: the bar's edge effect is the page's, not the carousel's.
        .scrollEdgeEffectHidden(true, for: .all)
        // Clipped at the sides only, so the art can stretch up into a pulled-down page.
        .scrollClipDisabled()
        .clipShape(OpenTopRectangle())
        // A share of the page's height, as HeroBillboard sizes itself; its pages fill this.
        .containerRelativeFrame(.vertical) { length, _ in
            HeroLayout.height(featured: roomy, regular: roomy, container: length)
        }
    }
    #else
    private var content: some View { hero(cards[min(index, cards.count - 1)]) }
    #endif

    /// What Play does for a title, as its page would answer it. Without one, the wide
    /// button opens the title.
    private func playChoice(_ card: TitleCard) -> PlayChoice? {
        // A movie in the library plays straight away, before the server has been asked.
        (plays[card.id] ?? TitleActions.libraryPlay(card)).choice
    }

    private func hasPlay(_ card: TitleCard) -> Bool { playChoice(card) != nil }

    /// Asks the server what Play does for the title on screen, unless the library already said.
    private func resolvePlay(_ card: TitleCard) async {
        guard plays[card.id] == nil, TitleActions.libraryPlay(card).choice == nil else { return }
        // A moment on screen first, so swiping past titles doesn't set off lookups.
        try? await Task.sleep(for: .milliseconds(600))
        guard !Task.isCancelled else { return }
        let options = await services.titles.play(card)
        guard !Task.isCancelled else { return }
        withAnimation(.easeInOut(duration: 0.25)) { plays[card.id] = options }
    }

    private func key(_ card: TitleCard) -> String { card.ref.description }

    /// "Movie · 2026 · ★ 7.8", for the featured layout.
    private func meta(_ card: TitleCard) -> [String] {
        [card.type == .movie ? String(localized: "Movie", bundle: .module) : String(localized: "TV Show", bundle: .module), card.yearText, card.ratingText.map { "★ \($0)" }].compactMap { $0 }
    }
    private func isListed(_ card: TitleCard) -> Bool { listed[key(card)] ?? watchlist.contains(key(card)) }

    /// Wide like the TV app's: the row's width on iPhone, a generous fixed width on iPad.
    private var primaryWidth: CGFloat {
        #if os(iOS)
        roomy ? 280 : .infinity
        #else
        300
        #endif
    }

    /// A size down from the detail pages' buttons on the TV, so the hero's text leads.
    private var heroControlSize: ControlSize {
        #if os(tvOS)
        .regular
        #else
        .large
        #endif
    }

    private func hero(_ card: TitleCard) -> some View {
        // Just the name on iPhone: the carousel is for picking, the title page has the
        // details. Apple TV and iPad have room for a line of facts and the synopsis.
        HeroBillboard(id: card.id, backdropURL: card.backdropUrl, fallbackURL: card.posterUrl, eyebrow: card.eyebrow, title: card.title, logoURL: card.logoUrl,
                      meta: roomy ? meta(card) : [], badges: roomy ? card.badge.map { [$0] } ?? [] : [],
                      overview: roomy ? card.overview : nil, paged: true, featured: true) {
            // Play when the server can play it now; otherwise the wide button opens it.
            if let choice = playChoice(card) {
                PlayButton(choice.label, maxWidth: primaryWidth, size: heroControlSize) { services.play(choice, title: card.title, artworkURL: card.backdropUrl) }
                #if os(tvOS)
                .focused($focus, equals: .play)
                #endif
            } else {
                #if !os(tvOS)
                // Nothing to play here: the wide button opens the title instead.
                Button { pushRoute(card.route) } label: {
                    Label(card.type == .movie ? "Go to Movie" : "Go to Show", systemImage: "chevron.right")
                        .labelStyle(TrailingIconLabelStyle())
                        .font(.stHeadline)
                        .padding(.horizontal, Metrics.space2)
                        .frame(maxWidth: primaryWidth, minHeight: 30)
                }
                .buttonStyle(.strataGlass)
                .controlSize(heroControlSize)
                .tint(Theme.ink)
                #endif
            }
            let on = isListed(card)
            // Ink: glass labels take the tint.
            Button { toggleList(card) } label: {
                Image(systemName: on ? "checkmark" : "plus")
                    .font(.stHeadline)
                    .frame(width: 30, height: 30)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.strataGlass)
            .buttonBorderShape(.circle)
            .controlSize(heroControlSize)
            .tint(Theme.ink)
            .accessibilityLabel(on ? Text("Remove from My List", bundle: .module) : Text("Add to My List", bundle: .module))
            #if os(tvOS)
            .focused($focus, equals: .add)
            #endif
            #if os(tvOS)
            // No art to click on the TV: its page is a button away.
            NavigationLink(value: card.route) {
                Image(systemName: "info")
                    .font(.stHeadline)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.strataGlass)
            .buttonBorderShape(.circle)
            .controlSize(heroControlSize)
            .tint(Theme.ink)
            .accessibilityLabel(Text("More Info", bundle: .module))
            .focused($focus, equals: .info)
            // The next featured title; focus stays here, so it can be pressed again.
            if cards.count > 1 {
                Button { step(1) } label: {
                    Image(systemName: "chevron.right")
                        .font(.stHeadline)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.strataGlass)
                .buttonBorderShape(.circle)
                .controlSize(heroControlSize)
                .tint(Theme.ink)
                .accessibilityLabel(Text("Next", bundle: .module))
                .focused($focus, equals: .next)
            }
            #endif
        }
    }

    private func toggleList(_ card: TitleCard) {
        let on = !isListed(card)
        listed[key(card)] = on
        Task {
            // On success Home reloads, so the My List rail and Coming Up follow.
            do { try await services.titles.setOnList(card.ref, on) } catch { listed[key(card)] = !on }
        }
    }

    /// Over the art on the TV; on the page (light or dark) on iPhone and iPad.
    #if os(tvOS)
    private let dotColor = Theme.onArtwork
    #else
    private let dotColor = Theme.ink
    #endif

    /// Like the TV app's: the current title's dot is a bar that fills until the next one.
    @ViewBuilder private var dots: some View {
        if cards.count > 1 {
            HStack(spacing: 6) {
                ForEach(cards.indices, id: \.self) { i in
                    Capsule()
                        .fill(dotColor.opacity(0.35))
                        .frame(width: i == index ? 28 : 6, height: 6)
                        .overlay(alignment: .leading) {
                            if i == index {
                                // A new fill for each turn, so it starts empty again.
                                TurnFill(color: dotColor.opacity(0.9), running: running, duration: Self.interval)
                                    .id(AdvanceKey(index: index, running: running))
                            }
                        }
                }
            }
            .animation(.easeInOut(duration: 0.3), value: index)
            #if os(tvOS)
            .padding(.bottom, Metrics.space8)
            #endif
            // Swipe up or down with VoiceOver for the next or previous title.
            .accessibilityElement()
            .accessibilityLabel(Text("Featured", bundle: .module))
            .accessibilityValue(Text("\(cards[min(index, cards.count - 1)].title), \(index + 1) of \(cards.count)", bundle: .module))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: go(1)
                case .decrement: go(-1)
                @unknown default: break
                }
            }
        }
    }
}

/// The current dot's bar, filling over a title's turn: one animation per turn rather
/// than redrawing every frame. Paused, it shows full.
private struct TurnFill: View {
    let color: Color
    let running: Bool
    let duration: Double
    @State private var progress: CGFloat

    init(color: Color, running: Bool, duration: Double) {
        self.color = color
        self.running = running
        self.duration = duration
        _progress = State(initialValue: running ? 0 : 1)
    }

    var body: some View {
        Capsule().fill(color)
            .frame(width: 6 + 22 * progress)
            .onAppear {
                guard running else { return }
                withAnimation(.linear(duration: duration)) { progress = 1 }
            }
    }
}

/// Title, then icon: "Go to Show ›".
private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) { configuration.title; configuration.icon.imageScale(.small) }
    }
}
