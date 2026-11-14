import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct MovieDetailView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let ref: TitleRef
    @State private var detail: Loadable<MovieDetail> = .loading
    @State private var inWatchlist = false
    /// What Play does, and the sources behind it; nil until the server answers.
    @State private var playOptions: PlayOptions?
    @State private var showSources = false

    var body: some View {
        ScrollView {
            switch detail {
            case .loading:
                DetailSkeleton()
            case .failed(let message):
                MessageView(systemImage: "exclamationmark.triangle", title: String(localized: "Couldn't load this movie", bundle: .module), message: message, actionTitle: String(localized: "Try Again", bundle: .module)) {
                    Task { await load() }
                }
                .frame(minHeight: 500)
            case .loaded(let movie):
                content(movie)
            }
        }
        .heroUnderBar()
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if os(tvOS)
        .toolbar(.hidden, for: .tabBar)
        // Content loads after the page appears, so focus Play once it's there
        // (otherwise the back button gets it).
        .onChange(of: detail.value?.ref) { _, id in if id != nil { heroFocus = hasPlay ? .play : .list } }
        // For a title the server looks up, Play arrives after the page: move to it then.
        .onChange(of: hasPlay) { _, hasPlay in if hasPlay, heroFocus != .play { heroFocus = .play } }
        #endif
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        #if !os(tvOS)
        .refreshable { await load(force: true) }
        #endif
        .task { await load() }
        .onChange(of: services.progressRevision) { Task { await load() } }
    }

    @ViewBuilder private func content(_ movie: MovieDetail) -> some View {
        VStack(alignment: .leading, spacing: Metrics.railGap) {
            HeroBillboard(id: movie.id,
                          backdropURL: movie.backdropUrl,
                          fallbackURL: movie.posterUrl,
                          eyebrow: movie.availabilityLabel ?? String(localized: "Movie", bundle: .module),
                          title: movie.title,
                          meta: [movie.genres.first, movie.yearText, movie.runtimeText, movie.certification, movie.ratings.tmdbStar(movie.ratingText)].compactMap { $0 },
                          badges: movie.sources.first?.specLabels.prefix(3).map { $0 } ?? [],
                          ratings: movie.ratings.badges,
                          overview: movie.overview, featured: Metrics.isTV,
                          credits: [HeroCredit(String(localized: "Starring", bundle: .module), movie.cast.prefix(3).map(\.name)), HeroCredit(String(localized: "Director", bundle: .module), movie.directors)].filter { !$0.names.isEmpty },
                          progress: movie.progress.flatMap { $0.isResumable ? HeroProgress(fraction: $0.fraction, label: Formatting.remaining(ms: $0.remainingMs)) : nil }) {
                // Plays when it's in the library or the server lists a source for it.
                if let choice = playChoice(movie) {
                    PlayButton(choice.label, size: Metrics.heroControlSize) { services.play(choice, title: movie.title, artworkURL: movie.backdropUrl ?? movie.posterUrl) }
                        .glassEffectID("play", in: namespace)
                        #if os(tvOS)
                        .focused($heroFocus, equals: .play)
                        #endif
                }
                GlassButton(inWatchlist ? String(localized: "In My List", bundle: .module) : String(localized: "My List", bundle: .module), systemImage: inWatchlist ? "checkmark" : "plus", iconOnly: !Metrics.isPadOrTV || Metrics.isTV, size: Metrics.heroControlSize) {
                    Task { await toggleWatchlist(movie) }
                }
                #if os(tvOS)
                .focused($heroFocus, equals: .list)
                #endif
                // Only when the server has sources to show.
                if let sources = playOptions?.sources, !sources.isEmpty {
                    GlassButton(String(localized: "Sources", bundle: .module), systemImage: "rectangle.stack", iconOnly: !Metrics.isPadOrTV || Metrics.isTV, size: Metrics.heroControlSize) { showSources = true }
                }
                #if os(iOS)
                if playChoice(movie) != nil {
                    DownloadButton(target: movie.target, title: movie.title, subtitle: movie.yearText,
                                   artworkURL: movie.backdropUrl ?? movie.posterUrl, known: playOptions?.sources ?? [])
                }
                #endif
                if let trailer = movie.trailer?.youtubeURL { TrailerButton(url: trailer) }
            }
            #if os(tvOS)
            // Part of the hero, so it scrolls away with it instead of floating over the page.
            .overlay(alignment: .topLeading) { TVBackButton { dismiss() } }
            #endif

            if let playOptions, playOptions.choice == nil {
                AvailabilityLabel(.unavailable).padding(.horizontal, Metrics.gutter)
            }

            // On the TV, under the hero's buttons (see `heroProgress`).
            if !Metrics.isTV, let progress = movie.progress, progress.isResumable {
                HStack(spacing: Metrics.space3) {
                    ProgressBar(progress.fraction).frame(maxWidth: 240)
                    Text(Formatting.remaining(ms: progress.remainingMs) ?? "").font(.stFootnote).foregroundStyle(Theme.ink3)
                }
                .padding(.horizontal, Metrics.gutter)
            }

            CastRail(cast: movie.cast)

            VideosRail(videos: movie.videos ?? [])

            RelatedRail(titles: movie.related)

            if !movie.recommendations.isEmpty {
                Rail(String(localized: "More Like This", bundle: .module)) {
                    ForEach(movie.recommendations) { card in
                        NavigationLink(value: card.route) { PosterCardLabel(card: card) }.cardButtonStyle()
                    }
                }
            }

            InfoGrid(rows: [
                (String(localized: "Original Title", bundle: .module), movie.anime?.originalTitle ?? ""),
                (String(localized: "Studio", bundle: .module), movie.anime?.studios.joined(separator: ", ") ?? ""),
                (String(localized: "Directed by", bundle: .module), movie.directors.joined(separator: ", ")),
                (String(localized: "Genres", bundle: .module), movie.genres.joined(separator: ", ")),
                (String(localized: "Released", bundle: .module), Formatting.date(movie.releaseDate)?.formatted(date: .abbreviated, time: .omitted) ?? ""),
                (String(localized: "Rating", bundle: .module), movie.ratingText.map { "\($0) / 10" } ?? ""),
                (String(localized: "AniList score", bundle: .module), movie.anime?.scoreText ?? ""),
            ])
        }
        .padding(.bottom, Metrics.space12)
        .pickerSheet(isPresented: $showSources) {
            // In the library, the page has only library sources: the sheet asks the server for more.
            SourcePickerSheet(target: movie.target, title: movie.title, known: playOptions?.sources ?? [], lookFurther: playOptions?.lookedFurther == false) { candidate in
                play(movie, candidateId: candidate.id)
            }
        }
        // Asked again only when Play's answer could change (it joins the library, or Play becomes Resume).
        .task(id: "\(movie.isAvailable)|\(movie.resumeMs != nil)") {
            playOptions = nil
            playOptions = await services.titles.play(movie)
        }
    }

    @Namespace private var namespace

    /// The server's answer once it's in; until then, the library's.
    private func playChoice(_ movie: MovieDetail) -> PlayChoice? { (playOptions ?? TitleActions.libraryPlay(movie)).choice }
    #if os(tvOS)
    @FocusState private var heroFocus: HeroFocus?
    enum HeroFocus: Hashable { case play, list }
    /// Play is on the page (the library has it, or the server found a source).
    private var hasPlay: Bool { detail.value.flatMap(playChoice) != nil }
    #endif

    private func play(_ movie: MovieDetail, candidateId: String? = nil) {
        services.play(WatchRequest(target: movie.target,
                                   meta: PlaybackMeta(title: movie.title, subtitle: movie.yearText, artworkURL: movie.backdropUrl ?? movie.posterUrl),
                                   candidateId: candidateId))
    }

    private func load(force: Bool = false) async {
        await services.loadCached(force: force, { try await $0.movie(ref, $1) }) { result in
            // Fades in over the skeleton the first time; later reloads swap in place.
            if case .loading = detail {
                withAnimation(.easeOut(duration: 0.25)) { detail = result }
            } else {
                detail = result
            }
            if let movie = result.value { inWatchlist = movie.inWatchlist }
        }
    }

    private func toggleWatchlist(_ movie: MovieDetail) async {
        inWatchlist.toggle()
        let on = inWatchlist
        do { try await services.titles.setOnList(movie.ref, on) } catch { inWatchlist = !on }
    }
}

/// "Other Seasons": an anime's sequels and prequels, when the server lists them.
struct RelatedRail: View {
    let titles: [TitleCard]

    var body: some View {
        if !titles.isEmpty {
            Rail(String(localized: "Other Seasons", bundle: .module)) {
                ForEach(titles) { card in
                    NavigationLink(value: card.route) { PosterCardLabel(card: card) }.cardButtonStyle()
                }
            }
        }
    }
}

struct CastRail: View {
    let cast: [CastMember]

    var body: some View {
        if !cast.isEmpty {
            Rail(String(localized: "Cast", bundle: .module)) {
                ForEach(cast.prefix(15)) { person in
                    NavigationLink(value: Route.person(person.id)) { member(person) }
                        .cardButtonStyle()
                        .accessibilityLabel([person.name, person.character].compactMap { $0 }.joined(separator: ", "))
                }
            }
        }
    }

    private func member(_ person: CastMember) -> some View {
        VStack(spacing: Metrics.space2) {
            // Cached and decoded off the main thread, so scrolling the rail back doesn't flash.
            RemoteImage(url: person.profileUrl, maxPixel: Int(avatar * 3)) {
                Theme.surface2.overlay { Text(person.name.prefix(1)).font(.stTitle2).foregroundStyle(Theme.ink3) }
            }
            .frame(width: avatar, height: avatar)
            .clipShape(Circle())
            Text(person.name).font(.stFootnote.weight(.semibold)).foregroundStyle(Theme.ink)
                .lineLimit(Metrics.isTV ? 2 : 1).multilineTextAlignment(.center)
            if let character = person.character { Text(character).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1) }
        }
        .frame(width: avatar + Self.columnExtra)
    }

    /// Room past the photo for the name: on the TV, enough that most names fit.
    #if os(tvOS)
    static let columnExtra: CGFloat = 70
    #else
    static let columnExtra: CGFloat = 16
    #endif

    private var avatar: CGFloat { Self.avatar }

    #if os(tvOS)
    static let avatar: CGFloat = 140
    #else
    @MainActor static var avatar: CGFloat { Metrics.isPad ? 96 : 72 }
    #endif
}

/// A detail page while it loads, laid out like one (hero, then Cast, then a poster
/// rail) so the page doesn't jump when it arrives.
struct DetailSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.railGap) {
            // Title pages use the featured layout on the TV.
            SkeletonHero(featured: Metrics.isTV)
            SkeletonRail(width: CastRail.avatar, circle: true)
            SkeletonRail(width: Metrics.posterWidth)
        }
        .padding(.bottom, Metrics.space12)
        .allowsHitTesting(false)
    }
}

/// Opens the trailer on YouTube. Labeled where there's room, icon-only on iPhone.
/// Not on tvOS, which has no browser to hand YouTube links to.
struct TrailerButton: View {
    let url: URL

    var body: some View {
        #if !os(tvOS)
        Link(destination: url) {
            if Metrics.isPad {
                Label(String(localized: "Trailer", bundle: .module), systemImage: "play.rectangle").font(.stHeadline).frame(minHeight: 30)
            } else {
                Image(systemName: "play.rectangle").font(.stHeadline).frame(minHeight: 30)
            }
        }
        .buttonStyle(.strataGlass)
        .controlSize(.large)
        .accessibilityLabel(Text("Trailer", bundle: .module))
        #endif
    }
}

/// "Trailers & Extras": YouTube trailers, teasers, clips and featurettes.
struct VideosRail: View {
    let videos: [TitleVideo]

    var body: some View {
        #if !os(tvOS)
        if !videos.isEmpty {
            Rail(String(localized: "Trailers & Extras", bundle: .module)) {
                ForEach(videos.filter { $0.watchURL != nil }) { video in
                    Link(destination: video.watchURL!) {
                        VStack(alignment: .leading, spacing: Metrics.space2) {
                            ArtworkImage(url: video.safeThumbnailURL, aspectRatio: 16 / 9, seed: video.key)
                                .overlay {
                                    Image(systemName: "play.fill")
                                        .font(.stHeadline)
                                        .foregroundStyle(Theme.onArtwork)
                                        .frame(width: 44, height: 44)
                                        .glassEffect(.regular, in: .circle)
                                }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(video.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                                Text(video.type).font(.stFootnote).foregroundStyle(Theme.ink3)
                            }
                        }
                        .frame(width: Metrics.landscapeWidth)
                    }
                    .cardButtonStyle()
                    .accessibilityLabel("\(video.type): \(video.name)" as String)
                }
            }
        }
        #endif
    }
}

struct InfoGrid: View {
    let rows: [(String, String)]

    var body: some View {
        let filled = rows.filter { !$0.1.isEmpty }
        if !filled.isEmpty {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                Text("Information", bundle: .module).railHeaderStyle()
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Metrics.space6, verticalSpacing: Metrics.space2) {
                    ForEach(filled, id: \.0) { row in
                        GridRow {
                            Text(row.0).font(.stFootnote).foregroundStyle(Theme.ink3)
                            Text(row.1).font(.stCallout).foregroundStyle(Theme.ink2)
                        }
                    }
                }
            }
            .padding(.horizontal, Metrics.gutter)
            #if os(tvOS)
            // Focusable so the remote can scroll down to it.
            .frame(maxWidth: .infinity, alignment: .leading)
            .focusable()
            #endif
        }
    }
}

#if os(tvOS)
/// tvOS has no navigation bar on full-screen detail pages, so this gives a visible
/// way back alongside the remote's Menu button.
struct TVBackButton: View {
    let action: () -> Void

    var body: some View {
        // Lines up with the title's left edge (the page bleeds under the side safe
        // area, so the gutter alone is the inset) and sits at the top safe margin.
        GlassButton(String(localized: "Back", bundle: .module), systemImage: "chevron.left", iconOnly: true, action: action)
            .padding(.leading, Metrics.gutter)
            .padding(.top, 60)
            .ignoresSafeArea()
    }
}
#endif
