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
                    SkeletonRail(aspectRatio: 16 / 9, width: Metrics.landscapeWidth)
                    SkeletonRail(width: Metrics.posterWidth)
                case .failed(let message):
                    MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load Home", message: message, actionTitle: "Try Again") {
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
                        MessageView(systemImage: "film.stack", title: "Nothing here yet",
                                    message: "Add media folders in your server's dashboard.")
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
        .navigationTitle("Home")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            // With the iPad sidebar, My List and the profile are there.
            if !showsSidebar {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink(value: Route.myList) { Label("My List", systemImage: "bookmark") }
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
        rails.insert(Shelf(id: "continue", title: "Continue Watching", kind: .continue, items: resume.flatMap(\.items)), at: first)
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
                        Button { if let r = card.watchRequest(restart: true) { services.play(r) } } label: { Label("Play from Beginning", systemImage: "arrow.counterclockwise") }
                        if let target = card.watchRequest()?.target {
                            Button { setWatched(target, true) } label: { Label("Mark as Watched", systemImage: "checkmark.circle") }
                        }
                        // Off the rail until it's watched again; progress is kept.
                        Button(role: .destructive) { hide(card) } label: {
                            Label("Remove from Continue Watching", systemImage: "minus.circle")
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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([card.title, card.yearText, card.providerKinds.first.map { "on \($0.label)" }].compactMap { $0 }.joined(separator: ", "))
    }
}

/// Upcoming episodes of shows on My List, soonest first; the title opens the Calendar.
struct ComingUpRail: View {
    @Environment(\.pushRoute) private var pushRoute
    let episodes: [CalendarEpisode]

    var body: some View {
        if !episodes.isEmpty {
            Rail("Upcoming Episodes", seeAll: { pushRoute(.calendar) }) {
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
        if calendar.isDateInToday(episode.date) { return "Today" + time }
        if calendar.isDateInTomorrow(episode.date) { return "Tomorrow" + time }
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
    /// When the current title started its turn, for the progress in its dot.
    @State private var turnStarted = Date.now
    /// Only moves on while it's on screen and the app is active (Home stays alive under
    /// other tabs and pushed pages).
    @State private var visible = false
    @Environment(\.scenePhase) private var scenePhase
    #if os(tvOS)
    @FocusState private var focus: HeroButton?
    enum HeroButton: Hashable { case play, add, info, next }
    #endif

    private static let interval: Double = 8

    private struct AdvanceKey: Equatable {
        let index: Int
        let running: Bool
    }

    private var running: Bool {
        #if os(tvOS)
        // Not while someone's on a button: the title would change under them.
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
            .onChange(of: watchlist) { listed = [:] }
            .onAppear { visible = true }
            #if os(tvOS)
            .task {
                // Not when the app opened on a link: that page goes over Home and keeps focus.
                guard takesLaunchFocus, !Self.tookLaunchFocus, !cards.isEmpty,
                      services.coordinator.pendingRoute == nil else { return }
                Self.tookLaunchFocus = true
                // After the buttons are in place, so the focus engine can find them.
                try? await Task.sleep(for: .milliseconds(150))
                guard visible, services.coordinator.pendingRoute == nil else { return }
                if focus == nil { focus = hasPlay(cards[min(index, cards.count - 1)]) ? .play : .add }
            }
            #endif
            .onDisappear { visible = false }
            // Only the title on screen: asking about all of them would send the server
            // looking for sources for ten titles at once.
            // After watching, Up Next moves on: ask again.
            .onChange(of: services.progressRevision) { plays = [:] }
            .task(id: cards.isEmpty ? nil : "\(cards[min(index, cards.count - 1)].id)|\(services.progressRevision)") {
                guard !cards.isEmpty else { return }
                await resolvePlay(cards[min(index, cards.count - 1)])
            }
            // Restarts on every change, manual or not, so a swipe gets a full interval.
            .task(id: AdvanceKey(index: index, running: running)) {
                turnStarted = .now
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
    }

    private func step(_ by: Int) {
        let keep = focus
        withAnimation(.easeInOut(duration: 0.4)) { index = (index + by + cards.count) % cards.count }
        // The new title's buttons replace the old ones: keep focus on the same kind.
        DispatchQueue.main.async { focus = keep == .play && !hasPlay(cards[index]) ? .add : keep }
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
                        .accessibilityAction(named: card.type == .movie ? "Go to Movie" : "Go to Show") { pushRoute(card.route) }
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
        .frame(height: Metrics.isPad ? 720 : 520)
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
        [card.type == .movie ? "Movie" : "TV Show", card.yearText, card.ratingText.map { "★ \($0)" }].compactMap { $0 }
    }
    private func isListed(_ card: TitleCard) -> Bool { listed[key(card)] ?? watchlist.contains(key(card)) }

    /// Wide like the TV app's: the row's width on iPhone, a generous fixed width on iPad.
    private var primaryWidth: CGFloat {
        #if os(iOS)
        Metrics.isPad ? 280 : .infinity
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
        HeroBillboard(id: card.id, backdropURL: card.backdropUrl, fallbackURL: card.posterUrl, eyebrow: card.eyebrow, title: card.title,
                      meta: Metrics.isPadOrTV ? meta(card) : [], badges: Metrics.isPadOrTV ? card.badge.map { [$0] } ?? [] : [],
                      overview: Metrics.isPadOrTV ? card.overview : nil, paged: true, featured: true) {
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
                .buttonStyle(.glass)
                .controlSize(heroControlSize)
                .tint(Theme.ink)
                #endif
            }
            let on = isListed(card)
            // Ink, not the accent: glass labels take the tint, and apricot means Play.
            Button { toggleList(card) } label: {
                Image(systemName: on ? "checkmark" : "plus")
                    .font(.stHeadline)
                    .frame(width: 30, height: 30)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(heroControlSize)
            .tint(Theme.ink)
            .accessibilityLabel(on ? "Remove from My List" : "Add to My List")
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
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(heroControlSize)
            .tint(Theme.ink)
            .accessibilityLabel("More Info")
            .focused($focus, equals: .info)
            // The next featured title; focus stays here, so it can be pressed again.
            if cards.count > 1 {
                Button { step(1) } label: {
                    Image(systemName: "chevron.right")
                        .font(.stHeadline)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(heroControlSize)
                .tint(Theme.ink)
                .accessibilityLabel("Next")
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
            TimelineView(.animation(minimumInterval: 1 / 30, paused: !running)) { context in
                let elapsed = running ? min(1, context.date.timeIntervalSince(turnStarted) / Self.interval) : 1
                HStack(spacing: 6) {
                    ForEach(cards.indices, id: \.self) { i in
                        Capsule()
                            .fill(dotColor.opacity(0.35))
                            .frame(width: i == index ? 28 : 6, height: 6)
                            .overlay(alignment: .leading) {
                                if i == index {
                                    Capsule().fill(dotColor.opacity(0.9)).frame(width: max(6, 28 * elapsed))
                                }
                            }
                    }
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

/// Title, then icon: "Go to Show ›".
private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) { configuration.title; configuration.icon.imageScale(.small) }
    }
}
