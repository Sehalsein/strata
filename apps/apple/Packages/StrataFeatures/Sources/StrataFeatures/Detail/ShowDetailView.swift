import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct ShowDetailView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let ref: TitleRef
    @State private var detail: Loadable<ShowDetail> = .loading
    @State private var selectedSeason: Int?
    @State private var season: Loadable<SeasonDetail> = .loading
    @State private var inWatchlist = false
    /// What Play does (Up Next), and the sources behind it; nil until the server answers.
    @State private var playOptions: PlayOptions?
    @State private var sourcesFor: EpisodeItem?
    /// The episode whose source is being chosen to download.
    @State private var downloadFor: EpisodeItem?
    @State private var showUpNextSources = false
    /// "Not in your library" after asking the server about an episode it has nothing for.
    @State private var notice: String?
    /// The episode whose source is being looked up (a few seconds when it isn't in the library).
    @State private var resolving: String?
    #if os(tvOS)
    @FocusState private var heroFocus: HeroFocus?
    enum HeroFocus: Hashable { case play, list }
    /// Play is on the page (the library has it, or the server found a source).
    private var hasPlay: Bool { detail.value.flatMap { (playOptions ?? TitleActions.libraryPlay($0)).choice } != nil }
    #endif

    var body: some View {
        ScrollView {
            switch detail {
            case .loading:
                DetailSkeleton()
            case .failed(let message):
                MessageView(systemImage: "exclamationmark.triangle", title: String(localized: "Couldn't load this show", bundle: .module), message: message, actionTitle: String(localized: "Try Again", bundle: .module)) {
                    Task { await load() }
                }
                .frame(minHeight: 500)
            case .loaded(let show):
                content(show)
            }
        }
        .heroUnderBar()
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if os(tvOS)
        .toolbar(.hidden, for: .tabBar)
        // Content loads after the page appears, so focus Play once it's there.
        .onChange(of: detail.value?.ref) { _, id in if id != nil { heroFocus = hasPlay ? .play : .list } }
        // For a title the server looks up, Play arrives after the page: move to it then.
        .onChange(of: hasPlay) { _, hasPlay in if hasPlay, heroFocus != .play { heroFocus = .play } }
        #endif
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        #if !os(tvOS)
        .refreshable { await load(force: true); await loadSeason(quietly: true, force: true) }
        #endif
        .task { await load() }
        .onChange(of: services.progressRevision) { Task { await load(); await loadSeason(quietly: true) } }
        .task(id: selectedSeason) { await loadSeason() }
    }

    @ViewBuilder private func content(_ show: ShowDetail) -> some View {
        VStack(alignment: .leading, spacing: Metrics.railGap) {
            HeroBillboard(id: show.id,
                          backdropURL: show.backdropUrl,
                          fallbackURL: show.posterUrl,
                          eyebrow: show.availabilityLabel ?? String(localized: "Show", bundle: .module),
                          title: show.title,
                          meta: [show.genres.first, show.yearRangeText, show.certification, seasonCount(show), show.ratings.tmdbStar(show.ratingText)].compactMap { $0 },
                          ratings: show.ratings.badges,
                          overview: show.overview, featured: Metrics.isTV,
                          credits: [HeroCredit(String(localized: "Starring", bundle: .module), show.cast.prefix(3).map(\.name))].filter { !$0.names.isEmpty }) {
                // Plays when it's in the library or the server lists a source for it.
                if let choice = (playOptions ?? TitleActions.libraryPlay(show)).choice {
                    PlayButton(choice.label, size: Metrics.heroControlSize) { services.play(choice, title: show.title, artworkURL: show.backdropUrl) }
                    #if os(tvOS)
                    .focused($heroFocus, equals: .play)
                    #endif
                }
                GlassButton(inWatchlist ? String(localized: "In My List", bundle: .module) : String(localized: "My List", bundle: .module), systemImage: inWatchlist ? "checkmark" : "plus", iconOnly: !Metrics.isPadOrTV || Metrics.isTV, size: Metrics.heroControlSize) {
                    Task { await toggleWatchlist(show) }
                }
                #if os(tvOS)
                .focused($heroFocus, equals: .list)
                #endif
                // Only when the server has sources to show.
                if let sources = playOptions?.sources, !sources.isEmpty {
                    GlassButton(String(localized: "Sources", bundle: .module), systemImage: "rectangle.stack", iconOnly: !Metrics.isPadOrTV || Metrics.isTV, size: Metrics.heroControlSize) { showUpNextSources = true }
                }
                if let trailer = show.trailer?.youtubeURL { TrailerButton(url: trailer) }
            }
            #if os(tvOS)
            // Part of the hero, so it scrolls away with it instead of floating over the page.
            .overlay(alignment: .topLeading) { TVBackButton { dismiss() } }
            #endif

            seasonSection(show)

            CastRail(cast: show.cast)

            VideosRail(videos: show.videos ?? [])

            RelatedRail(titles: show.related)

            if !show.recommendations.isEmpty {
                Rail(String(localized: "More Like This", bundle: .module)) {
                    ForEach(show.recommendations) { card in
                        NavigationLink(value: card.route) { PosterCardLabel(card: card) }.cardButtonStyle()
                    }
                }
            }

            InfoGrid(rows: [
                (String(localized: "Original Title", bundle: .module), show.anime?.originalTitle ?? ""),
                (String(localized: "Studio", bundle: .module), show.anime?.studios.joined(separator: ", ") ?? ""),
                (String(localized: "Status", bundle: .module), show.status ?? ""),
                (String(localized: "Genres", bundle: .module), show.genres.joined(separator: ", ")),
                (String(localized: "First Aired", bundle: .module), Formatting.date(show.firstAirDate)?.formatted(date: .abbreviated, time: .omitted) ?? ""),
                (String(localized: "Rating", bundle: .module), show.ratingText.map { "\($0) / 10" } ?? ""),
                (String(localized: "AniList score", bundle: .module), show.anime?.scoreText ?? ""),
                (String(localized: "Next Episode", bundle: .module), show.anime?.nextEpisodeText ?? ""),
            ])
        }
        .padding(.bottom, Metrics.space12)
        .pickerSheet(item: $sourcesFor) { episode in
            SourcePickerSheet(target: episode.target(show: show.ref), title: "\(show.title) · \(episode.code)") { candidate in
                play(show, season: episode.season, episode: episode.episode, name: episode.name, still: episode.stillUrl, candidateId: candidate.id)
            }
        }
        #if os(iOS)
        .pickerSheet(item: $downloadFor) { episode in
            SourcePickerSheet(target: episode.target(show: show.ref), title: "\(show.title) · \(episode.code)", purpose: .download) { candidate in
                Task {
                    notice = await services.download(episode.target(show: show.ref), candidateId: candidate.id, title: show.title,
                                                     subtitle: "\(episode.code) · \(episode.name)", artworkURL: episode.stillUrl ?? show.backdropUrl)
                }
            }
        }
        #endif
        .pickerSheet(isPresented: $showUpNextSources) {
            if let upNext = show.upNext {
                SourcePickerSheet(target: .episode(show: show.ref, season: upNext.season, episode: upNext.episode),
                                  title: "\(show.title) · \(code(upNext.season, upNext.episode))", known: playOptions?.sources ?? [], lookFurther: playOptions?.lookedFurther == false) { candidate in
                    play(show, season: upNext.season, episode: upNext.episode, name: nil, still: nil, candidateId: candidate.id)
                }
            }
        }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "OK", bundle: .module), role: .cancel) { notice = nil }
        }
        // Asked again when Up Next moves on, or Play's answer for it could change.
        .task(id: show.upNext.map { "\($0.season)x\($0.episode)|\($0.isAvailable)|\($0.isResume)" }) {
            playOptions = nil
            playOptions = await services.titles.play(show)
        }
    }

    @ViewBuilder private func seasonSection(_ show: ShowDetail) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            HStack {
                Picker(String(localized: "Season", bundle: .module), selection: Binding(get: { selectedSeason ?? show.orderedSeasons.first?.season ?? 1 }, set: { selectedSeason = $0 })) {
                    ForEach(show.orderedSeasons) { s in
                        Text(s.name).tag(s.season)
                    }
                }
                .pickerStyle(.menu)
                .buttonStyle(.strataGlass)
                .tint(Theme.ink)
                Spacer()
                if let summary = show.orderedSeasons.first(where: { $0.season == currentSeason(show) }), summary.availableEpisodes > 0 {
                    Text("\(summary.availableEpisodes) of \(summary.episodeCount) in library", bundle: .module).font(.stFootnote).foregroundStyle(Theme.ink3)
                }
            }
            .padding(.horizontal, Metrics.gutter)

            switch season {
            case .loading:
                SkeletonEpisodeRows()
            case .failed(let message):
                Text(message).font(.stCallout).foregroundStyle(Theme.danger).padding(.horizontal, Metrics.gutter)
            case .loaded(let detail):
                LazyVStack(spacing: Self.episodeGap) {
                    ForEach(detail.episodes) { episode in
                        Button {
                            Task { await playEpisode(show, episode) }
                        } label: {
                            EpisodeRow(id: "\(show.ref)-\(episode.id)",
                                       number: episode.episode,
                                       title: episode.name,
                                       overview: episode.overview,
                                       foot: foot(episode),
                                       imdbRating: episode.imdbRating,
                                       stillURL: episode.stillUrl,
                                       progress: episode.progressFraction,
                                       isCurrent: show.upNext.map { $0.season == episode.season && $0.episode == episode.episode } ?? false) {
                                #if os(iOS)
                                if let item = DownloadStore.shared.item(signInID: services.store.activeID, target: episode.target(show: show.ref)) {
                                    DownloadStateLabel(item: item).font(.stHeadline).foregroundStyle(Theme.ink3)
                                }
                                #endif
                                // Playable is the default, so only exceptions get an icon.
                                if resolving == episode.id {
                                    ProgressView().accessibilityLabel(Text("Finding a source", bundle: .module))
                                } else if let state = rowState(episode) {
                                    Image(systemName: state.systemImage)
                                        .font(.stHeadline)
                                        .foregroundStyle(Theme.ink3)
                                        .accessibilityLabel(state.title)
                                }
                            }
                        }
                        #if os(tvOS)
                        // A native TV card per episode, which lifts on focus.
                        .buttonStyle(.card)
                        #else
                        .buttonStyle(FocusLiftStyle())
                        #endif
                        // Upcoming rows stay enabled: on the TV a disabled row can't take focus,
                        // so the season's later episodes and their menu would be out of reach.
                        .contextMenu {
                            Button { Task { await setWatched(show, episode, !episode.isWatched) } } label: {
                                Label(episode.isWatched ? String(localized: "Mark as Unwatched", bundle: .module) : String(localized: "Mark as Watched", bundle: .module), systemImage: episode.isWatched ? "eye.slash" : "eye")
                            }
                            if episode.isAvailable {
                                Button { play(show, season: episode.season, episode: episode.episode, name: episode.name, still: episode.stillUrl, startMs: 0) } label: {
                                    Label(String(localized: "Play from Beginning", bundle: .module), systemImage: "arrow.counterclockwise")
                                }
                            }
                            if !episode.isUpcoming {
                                Button { sourcesFor = episode } label: { Label(String(localized: "Choose Source", bundle: .module), systemImage: "rectangle.stack") }
                            }
                            #if os(iOS)
                            if !episode.isUpcoming {
                                if let item = DownloadStore.shared.item(signInID: services.store.activeID, target: episode.target(show: show.ref)) {
                                    DownloadActions(item: item)
                                } else {
                                    Button { downloadFor = episode } label: { Label(String(localized: "Download Episode", bundle: .module), systemImage: "arrow.down.circle") }
                                }
                            }
                            #endif
                        }
                        #if !os(tvOS)
                        if episode.id != detail.episodes.last?.id { Divider().overlay(Theme.hairline).padding(.leading, Metrics.space4) }
                        #endif
                    }
                }
                #if !os(tvOS)
                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                #endif
                .padding(.horizontal, Metrics.gutter)
            }
        }
    }

    /// Separate cards on the TV; one panel with dividers elsewhere.
    private static var episodeGap: CGFloat { Metrics.isTV ? Metrics.space5 : 0 }

    private func rowState(_ e: EpisodeItem) -> Availability? {
        if e.isWatched { return .watched }
        if e.isUpcoming || !e.isAvailable { return .unavailable }
        return nil
    }

    private func foot(_ e: EpisodeItem) -> String {
        var parts: [String] = []
        if let date = e.airDateValue { parts.append(date.formatted(date: .abbreviated, time: .omitted)) }
        if let runtime = e.runtimeText { parts.append(runtime) }
        if let p = e.progress, p.isResumable, let left = Formatting.remaining(ms: p.remainingMs) { parts.append(left) }
        if e.isUpcoming { parts.append(String(localized: "Coming soon", bundle: .module)) }
        return parts.joined(separator: " · ")
    }

    private func code(_ s: Int, _ e: Int) -> String { String(localized: "S\(s) · E\(e)", bundle: .module) }
    private func seasonCount(_ show: ShowDetail) -> String? {
        let n = show.seasons.filter { !$0.isSpecials }.count
        return n > 0 ? String(localized: "\(n) Seasons", bundle: .module) : nil
    }
    private func currentSeason(_ show: ShowDetail) -> Int { selectedSeason ?? show.orderedSeasons.first?.season ?? 1 }

    private func play(_ show: ShowDetail, season: Int, episode: Int, name: String?, still: URL?, candidateId: String? = nil, startMs: Int? = nil) {
        let subtitle = [code(season, episode), name].compactMap { $0 }.joined(separator: " · ")
        services.play(WatchRequest(target: .episode(show: show.ref, season: season, episode: episode),
                                   meta: PlaybackMeta(title: show.title, subtitle: subtitle, artworkURL: still ?? show.backdropUrl),
                                   candidateId: candidateId, startMs: startMs))
    }

    /// An episode in the library plays; otherwise the server is asked what it can play it from.
    private func playEpisode(_ show: ShowDetail, _ episode: EpisodeItem) async {
        if episode.isUpcoming {
            notice = String(localized: "\(code(episode.season, episode.episode)) hasn't aired yet.", bundle: .module)
            return
        }
        // One lookup at a time: a second tap mustn't open the player twice.
        guard resolving == nil else { return }
        resolving = episode.id
        defer { resolving = nil }
        if let choice = await services.titles.play(episode, of: show.ref) {
            services.play(choice, title: show.title, artworkURL: episode.stillUrl ?? show.backdropUrl)
        } else {
            notice = String(localized: "\(code(episode.season, episode.episode)) isn't in your library.", bundle: .module)
        }
    }

    private func load(force: Bool = false) async {
        await services.loadCached(force: force, { try await $0.show(ref, $1) }) { result in
            // Fades in over the skeleton the first time; later reloads swap in place.
            if case .loading = detail {
                withAnimation(.easeOut(duration: 0.25)) { detail = result }
            } else {
                detail = result
            }
            if let show = result.value {
                inWatchlist = show.inWatchlist
                if selectedSeason == nil { selectedSeason = show.upNext?.season ?? show.orderedSeasons.first?.season }
            }
        }
    }

    /// `quietly` keeps the current episodes on screen while refreshing their progress.
    private func loadSeason(quietly: Bool = false, force: Bool = false) async {
        guard let n = selectedSeason else { return }
        if !quietly { season = .loading }
        await services.loadCached(force: force, { try await $0.season(show: ref, n, $1) }) { season = $0 }
    }

    /// The page reloads (with Up Next) on the change that follows.
    private func setWatched(_ show: ShowDetail, _ episode: EpisodeItem, _ watched: Bool) async {
        try? await services.titles.setWatched(episode.target(show: show.ref), watched)
    }

    private func toggleWatchlist(_ show: ShowDetail) async {
        inWatchlist.toggle()
        let on = inWatchlist
        do { try await services.titles.setOnList(show.ref, on) } catch { inWatchlist = !on }
    }
}
