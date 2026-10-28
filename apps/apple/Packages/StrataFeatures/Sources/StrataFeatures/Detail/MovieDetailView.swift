import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct MovieDetailView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let tmdbId: Int
    @State private var detail: Loadable<MovieDetail> = .loading
    @State private var inWatchlist = false
    /// What the server can play this from; nil until it answers.
    @State private var sources: [Candidate]?
    @State private var showSources = false

    var body: some View {
        ScrollView {
            switch detail {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, minHeight: 500)
            case .failed(let message):
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load this movie", message: message, actionTitle: "Try Again") {
                    Task { await load() }
                }
                .frame(minHeight: 500)
            case .loaded(let movie):
                content(movie)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        .ignoresSafeArea(edges: .top)
        #if os(tvOS)
        .toolbar(.hidden, for: .tabBar)
        // Content loads after the page appears, so focus Play once it's there
        // (otherwise the back button gets it).
        .onChange(of: detail.value?.tmdbId) { _, id in if id != nil { playFocused = true } }
        #endif
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .onChange(of: services.progressRevision) { Task { await load() } }
    }

    @ViewBuilder private func content(_ movie: MovieDetail) -> some View {
        VStack(alignment: .leading, spacing: Metrics.railGap) {
            HeroBillboard(id: movie.id,
                          backdropURL: movie.backdropUrl,
                          fallbackURL: movie.posterUrl,
                          eyebrow: movie.availabilityLabel ?? "Movie",
                          title: movie.title,
                          meta: [movie.genres.first, movie.yearText, movie.runtimeText, movie.certification, movie.ratingText.map { "★ \($0)" }].compactMap { $0 },
                          badges: movie.sources.first?.specLabels.prefix(3).map { $0 } ?? [],
                          overview: movie.overview) {
                // Plays when it's in the library or the server lists a source for it.
                if canPlay(movie) {
                    PlayButton(movie.resumeMs != nil ? "Resume" : "Play") { play(movie, candidateId: movie.isAvailable ? nil : sources?.first?.id) }
                        .glassEffectID("play", in: namespace)
                        #if os(tvOS)
                        .focused($playFocused)
                        #endif
                }
                GlassButton(inWatchlist ? "In My List" : "My List", systemImage: inWatchlist ? "checkmark" : "plus", iconOnly: !Metrics.isPadOrTV) {
                    Task { await toggleWatchlist(movie) }
                }
                // Only when the server has sources to show.
                if let sources, !sources.isEmpty {
                    GlassButton("Sources", systemImage: "rectangle.stack", iconOnly: !Metrics.isPadOrTV) { showSources = true }
                }
                if let trailer = movie.trailer?.youtubeURL { TrailerButton(url: trailer) }
            }
            #if os(tvOS)
            // Part of the hero, so it scrolls away with it instead of floating over the page.
            .overlay(alignment: .topLeading) { TVBackButton { dismiss() } }
            #endif

            if !movie.isAvailable, sources?.isEmpty == true {
                AvailabilityLabel(.unavailable).padding(.horizontal, Metrics.gutter)
            }

            if let progress = movie.progress, progress.isResumable {
                HStack(spacing: Metrics.space3) {
                    ProgressBar(progress.fraction).frame(maxWidth: 240)
                    Text(Formatting.remaining(ms: progress.remainingMs) ?? "").font(.stFootnote).foregroundStyle(Theme.ink3)
                }
                .padding(.horizontal, Metrics.gutter)
            }

            if let tagline = movie.tagline {
                Text(tagline).font(.stCallout.italic()).foregroundStyle(Theme.ink2).padding(.horizontal, Metrics.gutter)
            }

            CastRail(cast: movie.cast)

            VideosRail(videos: movie.videos ?? [])

            if !movie.recommendations.isEmpty {
                Rail("More Like This") {
                    ForEach(movie.recommendations) { card in
                        NavigationLink(value: card.route) { PosterCardLabel(card: card) }.buttonStyle(StrataCardStyle())
                    }
                }
            }

            InfoGrid(rows: [
                ("Original title", movie.anime?.originalTitle ?? ""),
                ("Studio", movie.anime?.studios.joined(separator: ", ") ?? ""),
                ("Directed by", movie.directors.joined(separator: ", ")),
                ("Genres", movie.genres.joined(separator: ", ")),
                ("Released", Formatting.date(movie.releaseDate)?.formatted(date: .abbreviated, time: .omitted) ?? ""),
                ("Rating", movie.ratingText.map { "\($0) / 10" } ?? ""),
                ("AniList score", movie.anime?.scoreText ?? ""),
            ])
        }
        .padding(.bottom, Metrics.space12)
        .sheet(isPresented: $showSources) {
            SourcePickerSheet(target: movie.target, title: movie.title, initial: sources) { candidate in
                play(movie, candidateId: candidate.id)
            }
        }
        .task(id: movie.tmdbId) { sources = await services.sources(for: movie.target) }
    }

    @Namespace private var namespace

    private func canPlay(_ movie: MovieDetail) -> Bool { movie.isAvailable || sources?.isEmpty == false }
    #if os(tvOS)
    @FocusState private var playFocused: Bool
    #endif

    private func play(_ movie: MovieDetail, candidateId: String? = nil) {
        services.play(WatchRequest(target: movie.target,
                                   meta: PlaybackMeta(title: movie.title, subtitle: movie.yearText, artworkURL: movie.backdropUrl ?? movie.posterUrl),
                                   candidateId: candidateId))
    }

    private func load() async {
        let result = await services.load { try await $0.movie(tmdbId) }
        if case .loading = result { return }
        detail = result
        if let movie = result.value { inWatchlist = movie.inWatchlist }
    }

    private func toggleWatchlist(_ movie: MovieDetail) async {
        inWatchlist.toggle()
        let on = inWatchlist
        if case .failed = await services.load({ try await $0.setWatchlist(.movie, tmdbId: movie.tmdbId, on) }) { inWatchlist = !on }
    }
}

struct CastRail: View {
    let cast: [CastMember]

    var body: some View {
        if !cast.isEmpty {
            Rail("Cast") {
                ForEach(cast.prefix(15)) { person in
                    NavigationLink(value: Route.person(person.id)) { member(person) }
                        .buttonStyle(StrataCardStyle())
                        .accessibilityLabel([person.name, person.character].compactMap { $0 }.joined(separator: ", "))
                }
            }
        }
    }

    private func member(_ person: CastMember) -> some View {
        VStack(spacing: Metrics.space2) {
            AsyncImage(url: person.profileUrl) { phase in
                if case .success(let image) = phase { image.resizable().scaledToFill() } else {
                    Theme.surface2.overlay { Text(person.name.prefix(1)).font(.stTitle2).foregroundStyle(Theme.ink3) }
                }
            }
            .frame(width: avatar, height: avatar)
            .clipShape(Circle())
            Text(person.name).font(.stFootnote.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
            if let character = person.character { Text(character).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1) }
        }
        .frame(width: avatar + 16)
    }

    #if os(tvOS)
    private let avatar: CGFloat = 140
    #else
    private var avatar: CGFloat { Metrics.isPad ? 96 : 72 }
    #endif
}

/// Opens the trailer on YouTube. Labeled where there's room, icon-only on iPhone.
/// Not on tvOS, which has no browser to hand YouTube links to.
struct TrailerButton: View {
    let url: URL

    var body: some View {
        #if !os(tvOS)
        Link(destination: url) {
            if Metrics.isPad {
                Label("Trailer", systemImage: "play.rectangle").font(.stHeadline).frame(minHeight: 30)
            } else {
                Image(systemName: "play.rectangle").font(.stHeadline).frame(minHeight: 30)
            }
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .accessibilityLabel("Trailer")
        #endif
    }
}

/// "Trailers & Extras": YouTube trailers, teasers, clips and featurettes.
struct VideosRail: View {
    let videos: [TitleVideo]

    var body: some View {
        #if !os(tvOS)
        if !videos.isEmpty {
            Rail("Trailers & Extras") {
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
                    .buttonStyle(StrataCardStyle())
                    .accessibilityLabel("\(video.type): \(video.name)")
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
                Text("Information").railHeaderStyle()
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
        GlassButton("Back", systemImage: "chevron.left", iconOnly: true, action: action)
            .padding(.leading, Metrics.gutter)
            .padding(.top, 60)
            .ignoresSafeArea()
    }
}
#endif
