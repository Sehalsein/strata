import SwiftUI
import StrataKit
import StrataDesign
import os

public struct ShowDetailView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    public let id: String

    @State private var state: Loadable<BaseItem> = .idle
    @State private var seasons: [BaseItem] = []
    @State private var selectedSeason: BaseItem?
    /// Every episode of the series, fetched once. The visible `episodes` list is
    /// derived from this by filtering on `selectedSeason` — see below. Deriving
    /// client-side (instead of re-fetching per season) keeps the list perfectly
    /// in sync with the highlighted season chip and sidesteps any server-side
    /// `seasonId` filtering quirk that left the list frozen on one season.
    @State private var allEpisodes: [BaseItem] = []
    @State private var similar: [BaseItem] = []
    @State private var isFavorite: Bool = false
    /// In-progress / next-unwatched episode for a mid-series viewer. Drives the
    /// primary Play button so it resumes instead of always offering S01E01.
    @State private var resumeTarget: BaseItem?

    /// Episodes of the selected season, derived from `allEpisodes`. Matches on
    /// the season's item id first, falling back to its number, so it stays
    /// correct even if some episodes carry only one of those fields.
    private var episodes: [BaseItem] {
        guard let season = selectedSeason else { return [] }
        let byId = allEpisodes.filter { $0.seasonId == season.id }
        if !byId.isEmpty { return byId }
        if let number = season.indexNumber {
            return allEpisodes.filter { $0.parentIndexNumber == number }
        }
        return byId
    }

    public init(id: String, path: Binding<[Route]>) {
        self.id = id
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: id, intensity: 0.95)
            AsyncContent(state, retry: { Task { await load() } }) { item in
                detail(item: item)
                    .handoffForViewing(item: item)
            }
        }
        .task { await load() }
    }

    private func detail(item: BaseItem) -> some View {
        #if os(tvOS)
        let heroHeight: CGFloat = 620
        let textGutter: CGFloat = 80
        #else
        let heroHeight: CGFloat = 460
        let textGutter: CGFloat = 20
        #endif
        return ScrollView {
            GeometryReader { geo in
                ZStack(alignment: .bottomLeading) {
                    if let url = services.images?.backdrop(itemId: id) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let img):
                                img.resizable().scaledToFill()
                                    .frame(width: geo.size.width, height: heroHeight)
                                    .clipped()
                                    .overlay(
                                        LinearGradient(
                                            colors: [.clear, Strata.Tokens.bg],
                                            startPoint: .top, endPoint: .bottom
                                        )
                                    )
                            default:
                                Rectangle().fill(Strata.Tokens.bg2)
                                    .frame(width: geo.size.width, height: heroHeight)
                            }
                        }
                        .frame(width: geo.size.width, height: heroHeight)
                        .clipped()
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        OpusBadge(key: id)
                        Text(item.displayTitle)
                            .font(.fraunces(heroTitleSize(for: geo.size.width, text: item.displayTitle),
                                            opticalSize: 144, soft: 30))
                            .foregroundStyle(Strata.Tokens.paper)
                            .minimumScaleFactor(0.5)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                        MetadataRow(item: item, extraChips: seasons.isEmpty ? [] : ["\(seasons.count) SEASONS"])
                        if let tag = item.taglines?.first {
                            Text(tag)
                                .font(.fraunces(20, opticalSize: 36, soft: 100))
                                .italic()
                                .foregroundStyle(Strata.Tokens.paperDim)
                                .padding(.top, 4)
                                .lineLimit(2)
                                .minimumScaleFactor(0.7)
                        }
                    }
                    .padding(.horizontal, textGutter)
                    .padding(.bottom, 20)
                    .padding(.top, 28)
                    .frame(width: geo.size.width, alignment: .leading)
                }
                .frame(width: geo.size.width, height: heroHeight)
            }
            .frame(height: heroHeight)

            VStack(alignment: .leading, spacing: sectionSpacing) {
                actionRow
                if let overview = item.overviewText {
                    Text(overview)
                        .font(.plex(15))
                        .foregroundStyle(Strata.Tokens.paper.opacity(0.86))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 720, alignment: .leading)
                }
                if !seasons.isEmpty {
                    seasonStrip
                }
                if !episodes.isEmpty {
                    episodeList
                }
                if let people = item.people, !people.isEmpty {
                    CastShelf(people: people, images: services.images) { person in
                        if let name = person.name, !name.isEmpty {
                            path.append(.search(query: name))
                        }
                    }
                }
                if !similar.isEmpty {
                    SimilarShelf(items: similar, images: services.images) { picked in
                        path.append(.unified(id: picked.id))
                    }
                }
                MovieInfoSection(item: item)
            }
            .padding(.horizontal, textGutter)
            .padding(.top, 12)
            .padding(.bottom, CGFloat.strataScrollBottom)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.pageGutter, textGutter)
        }
        #if os(tvOS)
        .ignoresSafeArea()
        #else
        .ignoresSafeArea(edges: .top)
        #endif
    }

    private var sectionSpacing: CGFloat {
        #if os(tvOS)
        40
        #else
        24
        #endif
    }

    /// Pick a hero title size that fits the device — same adaptive scale as
    /// the movie hero so series and film covers read identically.
    private func heroTitleSize(for width: CGFloat, text: String) -> CGFloat {
        if width < 420 {
            return text.count > 18 ? 34 : 42
        }
        if width < 720 { return 48 }
        return 56
    }

    private var actionRow: some View {
        // Resume the in-progress / next-unwatched episode when there is one,
        // otherwise start from the first episode of the selected season.
        let target = resumeTarget ?? episodes.first
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                if let target {
                    PrimaryButton(playLabel(target), systemImage: "play.fill") {
                        services.coordinator.requestWatch(target.id, start: target.resumePositionSeconds)
                    }
                }
                WatchlistButton(itemId: id, isFavorite: $isFavorite, client: services.client)
            }
        }
    }

    private func playLabel(_ episode: BaseItem) -> String {
        let season = episode.parentIndexNumber ?? 1
        let epNum = episode.indexNumber ?? 1
        let verb = episode.resumePositionSeconds != nil ? "Resume" : "Play"
        return String(format: "%@ S%02d·E%02d", verb, season, epNum)
    }

    private var seasonStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("SEASONS").strataSpec()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(seasons) { season in
                        Button {
                            selectedSeason = season
                        } label: {
                            let isActive = selectedSeason?.id == season.id
                            Text(season.name ?? "Season")
                                .font(.mono(12, weight: .semibold))
                                .tracking(1.5)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .foregroundStyle(isActive ? Strata.Tokens.bg : Strata.Tokens.paper)
                                .background(isActive ? Strata.Tokens.paper : Strata.Tokens.paper.opacity(0.06))
                                .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
                        }
                        #if os(tvOS)
                        .buttonStyle(StrataCardButtonStyle())
                        #else
                        .buttonStyle(.plain)
                        #endif
                    }
                }
            }
        }
    }

    private var episodeList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("EPISODES").strataSpec()
            ForEach(episodes) { ep in
                Button {
                    services.coordinator.requestWatch(ep.id, start: ep.resumePositionSeconds)
                } label: {
                    HStack(alignment: .top, spacing: 14) {
                        if let url = services.images?.episodeStill(itemId: ep.id, imageTags: ep.imageTags, maxWidth: 360) {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let img):
                                    img.resizable().scaledToFill()
                                default:
                                    Strata.Tokens.bg2
                                }
                            }
                            .frame(width: 160, height: 90)
                            .strataCard()
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                if let n = ep.indexNumber { Chip("E\(n)") }
                                Text(ep.displayTitle)
                                    .font(.fraunces(17, opticalSize: 40, soft: 50))
                                    .foregroundStyle(Strata.Tokens.paper)
                            }
                            if let overview = ep.overviewText {
                                Text(overview)
                                    .font(.plex(13))
                                    .foregroundStyle(Strata.Tokens.paperDim)
                                    .lineLimit(3)
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 8)
                }
                #if os(tvOS)
                .buttonStyle(StrataCardButtonStyle())
                #else
                .buttonStyle(.plain)
                #endif
                Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
            }
        }
    }

    private func load() async {
        guard let client = services.client else {
            state = .failed("Not signed in")
            return
        }
        if state.value == nil { state = .loading }
        // Seasons and recommendations are secondary; fetch them alongside the
        // series so neither blocks the hero from appearing.
        async let seasonsTask = (try? await client.getSeasons(seriesId: id)) ?? []
        async let episodesTask = (try? await client.getEpisodes(seriesId: id)) ?? []
        async let similarTask = (try? await client.getSimilarItems(itemId: id, limit: 12)) ?? []
        async let nextUpTask = (try? await client.nextUp(seriesId: id)) ?? nil
        let result = await loadable { try await client.getItem(id) }
        state = result
        if case .loaded(let fetched) = result {
            isFavorite = fetched.userData?.isFavorite ?? false
        }
        seasons = await seasonsTask
        allEpisodes = await episodesTask
        similar = await similarTask
        resumeTarget = await nextUpTask
        // Open on the season holding the resume target so the episode list lands
        // where the viewer left off; otherwise fall back to the first season.
        // `episodes` is derived from `selectedSeason`, so this is all it takes —
        // tapping another chip re-derives the list with no extra fetch.
        selectedSeason = resumeTarget
            .flatMap { target in seasons.first(where: { $0.id == target.seasonId }) }
            ?? seasons.first
    }
}
