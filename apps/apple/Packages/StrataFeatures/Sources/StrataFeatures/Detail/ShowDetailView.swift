import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct ShowDetailView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let tmdbId: Int
    @State private var detail: Loadable<ShowDetail> = .loading
    @State private var selectedSeason: Int?
    @State private var season: Loadable<SeasonDetail> = .loading
    @State private var inWatchlist = false
    /// What the server can play Up Next from; nil until it answers.
    @State private var upNextSources: [Candidate]?
    @State private var sourcesFor: EpisodeItem?
    @State private var showUpNextSources = false
    /// "Not in your library" after asking the server about an episode it has nothing for.
    @State private var notice: String?
    #if os(tvOS)
    @FocusState private var playFocused: Bool
    #endif

    var body: some View {
        ScrollView {
            switch detail {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, minHeight: 500)
            case .failed(let message):
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load this show", message: message, actionTitle: "Try Again") {
                    Task { await load() }
                }
                .frame(minHeight: 500)
            case .loaded(let show):
                content(show)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .ignoresSafeArea(edges: .top)
        #if os(tvOS)
        .toolbar(.hidden, for: .tabBar)
        // Content loads after the page appears, so focus Play once it's there.
        .onChange(of: detail.value?.tmdbId) { _, id in if id != nil { playFocused = true } }
        #endif
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
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
                          eyebrow: show.availabilityLabel ?? "Series",
                          title: show.title,
                          meta: [show.genres.first, show.yearRangeText, show.certification, seasonCount(show), show.ratingText.map { "★ \($0)" }].compactMap { $0 },
                          overview: show.overview) {
                // Plays when it's in the library or the server lists a source for it.
                if let upNext = show.upNext, upNext.isAvailable || upNextSources?.isEmpty == false {
                    PlayButton(upNext.isResume ? "Resume \(code(upNext.season, upNext.episode))" : "Play \(code(upNext.season, upNext.episode))") {
                        play(show, season: upNext.season, episode: upNext.episode, name: nil, still: nil,
                             candidateId: upNext.isAvailable ? nil : upNextSources?.first?.id)
                    }
                    #if os(tvOS)
                    .focused($playFocused)
                    #endif
                }
                GlassButton(inWatchlist ? "In My List" : "My List", systemImage: inWatchlist ? "checkmark" : "plus", iconOnly: !Metrics.isPadOrTV) {
                    Task { await toggleWatchlist(show) }
                }
                // Only when the server has sources to show.
                if let upNextSources, !upNextSources.isEmpty {
                    GlassButton("Sources", systemImage: "rectangle.stack", iconOnly: !Metrics.isPadOrTV) { showUpNextSources = true }
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

            if !show.recommendations.isEmpty {
                Rail("More Like This") {
                    ForEach(show.recommendations) { card in
                        NavigationLink(value: card.route) { PosterCardLabel(card: card) }.buttonStyle(StrataCardStyle())
                    }
                }
            }

            InfoGrid(rows: [
                ("Original title", show.anime?.originalTitle ?? ""),
                ("Studio", show.anime?.studios.joined(separator: ", ") ?? ""),
                ("Status", show.status ?? ""),
                ("Genres", show.genres.joined(separator: ", ")),
                ("First aired", Formatting.date(show.firstAirDate)?.formatted(date: .abbreviated, time: .omitted) ?? ""),
                ("Rating", show.ratingText.map { "\($0) / 10" } ?? ""),
                ("AniList score", show.anime?.scoreText ?? ""),
                ("Next episode", show.anime?.nextEpisodeText ?? ""),
            ])
        }
        .padding(.bottom, Metrics.space12)
        .sheet(item: $sourcesFor) { episode in
            SourcePickerSheet(target: episode.target(show: show.tmdbId), title: "\(show.title) · \(episode.code)") { candidate in
                play(show, season: episode.season, episode: episode.episode, name: episode.name, still: episode.stillUrl, candidateId: candidate.id)
            }
        }
        .sheet(isPresented: $showUpNextSources) {
            if let upNext = show.upNext {
                SourcePickerSheet(target: .episode(show: show.tmdbId, season: upNext.season, episode: upNext.episode),
                                  title: "\(show.title) · \(code(upNext.season, upNext.episode))", known: upNextSources ?? [], lookFurther: upNext.isAvailable) { candidate in
                    play(show, season: upNext.season, episode: upNext.episode, name: nil, still: nil, candidateId: candidate.id)
                }
            }
        }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK", role: .cancel) { notice = nil }
        }
        .task(id: show.upNext.map { "\($0.season)x\($0.episode)" }) {
            guard let upNext = show.upNext else { upNextSources = nil; return }
            // Looking further than the library only where that decides whether it can play.
            upNextSources = await services.sources(for: .episode(show: show.tmdbId, season: upNext.season, episode: upNext.episode), discover: !upNext.isAvailable)
        }
    }

    @ViewBuilder private func seasonSection(_ show: ShowDetail) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            HStack {
                Picker("Season", selection: Binding(get: { selectedSeason ?? show.orderedSeasons.first?.season ?? 1 }, set: { selectedSeason = $0 })) {
                    ForEach(show.orderedSeasons) { s in
                        Text(s.name).tag(s.season)
                    }
                }
                .pickerStyle(.menu)
                .buttonStyle(.glass)
                .tint(Theme.ink)
                Spacer()
                if let summary = show.orderedSeasons.first(where: { $0.season == currentSeason(show) }), summary.availableEpisodes > 0 {
                    Text("\(summary.availableEpisodes) of \(summary.episodeCount) in library").font(.stFootnote).foregroundStyle(Theme.ink3)
                }
            }
            .padding(.horizontal, Metrics.gutter)

            switch season {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, minHeight: 160)
            case .failed(let message):
                Text(message).font(.stCallout).foregroundStyle(Theme.danger).padding(.horizontal, Metrics.gutter)
            case .loaded(let detail):
                LazyVStack(spacing: 0) {
                    ForEach(detail.episodes) { episode in
                        Button {
                            Task { await playEpisode(show, episode) }
                        } label: {
                            EpisodeRow(id: "\(show.tmdbId)-\(episode.id)",
                                       number: episode.episode,
                                       title: episode.name,
                                       overview: episode.overview,
                                       foot: foot(episode),
                                       stillURL: episode.stillUrl,
                                       progress: episode.progressFraction,
                                       isCurrent: show.upNext.map { $0.season == episode.season && $0.episode == episode.episode } ?? false) {
                                // Playable is the default, so only exceptions get an icon.
                                if let state = rowState(episode) {
                                    Image(systemName: state.systemImage)
                                        .font(.stHeadline)
                                        .foregroundStyle(Theme.ink3)
                                        .accessibilityLabel(state.title)
                                }
                            }
                        }
                        .buttonStyle(FocusLiftStyle())
                        .disabled(episode.isUpcoming)
                        .contextMenu {
                            Button { Task { await setWatched(show, episode, !episode.isWatched) } } label: {
                                Label(episode.isWatched ? "Mark as Unwatched" : "Mark as Watched", systemImage: episode.isWatched ? "eye.slash" : "eye")
                            }
                            if episode.isAvailable {
                                Button { play(show, season: episode.season, episode: episode.episode, name: episode.name, still: episode.stillUrl, startMs: 0) } label: {
                                    Label("Play from Beginning", systemImage: "arrow.counterclockwise")
                                }
                            }
                            if !episode.isUpcoming {
                                Button { sourcesFor = episode } label: { Label("Choose Source", systemImage: "rectangle.stack") }
                            }
                        }
                        if episode.id != detail.episodes.last?.id { Divider().overlay(Theme.hairline).padding(.leading, Metrics.space4) }
                    }
                }
                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                .padding(.horizontal, Metrics.gutter)
            }
        }
    }

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
        if e.isUpcoming { parts.append("Coming soon") }
        return parts.joined(separator: " · ")
    }

    private func code(_ s: Int, _ e: Int) -> String { "S\(s) · E\(e)" }
    private func seasonCount(_ show: ShowDetail) -> String? {
        let n = show.seasons.filter { !$0.isSpecials }.count
        return n > 0 ? "\(n) Season\(n == 1 ? "" : "s")" : nil
    }
    private func currentSeason(_ show: ShowDetail) -> Int { selectedSeason ?? show.orderedSeasons.first?.season ?? 1 }

    private func play(_ show: ShowDetail, season: Int, episode: Int, name: String?, still: URL?, candidateId: String? = nil, startMs: Int? = nil) {
        let subtitle = [code(season, episode), name].compactMap { $0 }.joined(separator: " · ")
        services.play(WatchRequest(target: .episode(show: show.tmdbId, season: season, episode: episode),
                                   meta: PlaybackMeta(title: show.title, subtitle: subtitle, artworkURL: still ?? show.backdropUrl),
                                   candidateId: candidateId, startMs: startMs))
    }

    /// An episode in the library plays; otherwise the server is asked what it can play it from.
    private func playEpisode(_ show: ShowDetail, _ episode: EpisodeItem) async {
        guard !episode.isAvailable else {
            return play(show, season: episode.season, episode: episode.episode, name: episode.name, still: episode.stillUrl)
        }
        let found = await services.sources(for: episode.target(show: show.tmdbId), discover: true)
        if let first = found.first {
            play(show, season: episode.season, episode: episode.episode, name: episode.name, still: episode.stillUrl, candidateId: first.id)
        } else {
            notice = "\(code(episode.season, episode.episode)) isn't in your library."
        }
    }

    private func load() async {
        let result = await services.load { try await $0.show(tmdbId) }
        if case .loading = result { return }
        detail = result
        if let show = result.value {
            inWatchlist = show.inWatchlist
            if selectedSeason == nil { selectedSeason = show.upNext?.season ?? show.orderedSeasons.first?.season }
        }
    }

    /// `quietly` keeps the current episodes on screen while refreshing their progress.
    private func loadSeason(quietly: Bool = false) async {
        guard let n = selectedSeason else { return }
        if !quietly { season = .loading }
        let result = await services.load { try await $0.season(show: tmdbId, n) }
        if case .loading = result { return }
        season = result
    }

    private func setWatched(_ show: ShowDetail, _ episode: EpisodeItem, _ watched: Bool) async {
        _ = await services.load { try await $0.setWatched(episode.target(show: show.tmdbId), watched) }
        await services.client?.clearCache()
        await loadSeason()
    }

    private func toggleWatchlist(_ show: ShowDetail) async {
        inWatchlist.toggle()
        let on = inWatchlist
        if case .failed = await services.load({ try await $0.setWatchlist(.show, tmdbId: show.tmdbId, on) }) { inWatchlist = !on; return }
        // Its episodes join (or leave) the calendar and its notifications.
        await services.refreshEpisodeAlerts()
    }
}
