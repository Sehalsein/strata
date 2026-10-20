import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

struct MovieDetailView: View {
    @Environment(AppServices.self) private var services
    let tmdbId: Int
    @State private var detail: Loadable<MovieDetail> = .loading
    @State private var inWatchlist = false
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
        .ignoresSafeArea(edges: .top)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
    }

    @ViewBuilder private func content(_ movie: MovieDetail) -> some View {
        VStack(alignment: .leading, spacing: Metrics.railGap) {
            HeroBillboard(id: movie.id,
                          backdropURL: movie.backdropUrl,
                          eyebrow: movie.availabilityLabel ?? "Movie",
                          title: movie.title,
                          meta: [movie.yearText, movie.runtimeText, movie.certification].compactMap { $0 },
                          badges: movie.sources.first?.specLabels.prefix(3).map { $0 } ?? [],
                          overview: movie.overview) {
                PlayButton(movie.resumeMs != nil ? "Resume" : "Play") { play(movie, candidateId: nil) }
                    .glassEffectID("play", in: namespace)
                GlassButton(inWatchlist ? "In My List" : "My List", systemImage: inWatchlist ? "checkmark" : "plus", iconOnly: !Metrics.isPadOrTV) {
                    Task { await toggleWatchlist(movie) }
                }
                GlassButton("Sources", systemImage: "rectangle.stack", iconOnly: true) { showSources = true }
                if let trailer = movie.trailer?.youtubeURL {
                    #if !os(tvOS)
                    Link(destination: trailer) { Image(systemName: "play.rectangle").font(.stHeadline).frame(minHeight: 30) }
                        .buttonStyle(.glass)
                        .controlSize(.large)
                        .accessibilityLabel("Trailer")
                    #endif
                }
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

            if !movie.recommendations.isEmpty {
                Rail("More Like This") {
                    ForEach(movie.recommendations) { card in
                        NavigationLink(value: card.route) { PosterCardLabel(card: card) }.buttonStyle(StrataCardStyle())
                    }
                }
            }

            InfoGrid(rows: [
                ("Directed by", movie.directors.joined(separator: ", ")),
                ("Genres", movie.genres.joined(separator: ", ")),
                ("Released", movie.releaseDate ?? ""),
                ("Rating", movie.ratingText.map { "\($0) on TMDB" } ?? ""),
            ])
        }
        .padding(.bottom, Metrics.space12)
        .sheet(isPresented: $showSources) {
            SourcePickerSheet(target: movie.target, title: movie.title) { candidate in
                play(movie, candidateId: candidate.id)
            }
        }
    }

    @Namespace private var namespace

    private func play(_ movie: MovieDetail, candidateId: String?) {
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
                    #if os(tvOS)
                    .focusable()
                    #endif
                }
            }
        }
    }

    #if os(tvOS)
    private let avatar: CGFloat = 140
    #else
    private var avatar: CGFloat { Metrics.isPad ? 96 : 72 }
    #endif
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
        }
    }
}
