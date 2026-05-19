import SwiftUI
import StrataKit
import StrataDesign
import os

public struct ShowDetailView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    public let id: String

    @State private var item: BaseItem?
    @State private var seasons: [BaseItem] = []
    @State private var selectedSeason: BaseItem?
    @State private var episodes: [BaseItem] = []
    @State private var similar: [BaseItem] = []
    @State private var isFavorite: Bool = false

    public init(id: String, path: Binding<[Route]>) {
        self.id = id
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: id, intensity: 0.95)
            ScrollView {
                if let item {
                    VStack(alignment: .leading, spacing: 28) {
                        hero(item: item)
                            .handoffForViewing(item: item)
                        actionRow
                        if !seasons.isEmpty {
                            seasonStrip
                        }
                        if !episodes.isEmpty {
                            episodeList
                        }
                        if let people = item.people, !people.isEmpty {
                            CastShelf(people: people, images: services.images)
                        }
                        if !similar.isEmpty {
                            SimilarShelf(items: similar, images: services.images) { picked in
                                path.append(.unified(id: picked.id))
                            }
                        }
                        MovieInfoSection(item: item)
                        Spacer(minLength: 60)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 40)
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ProgressView().tint(Strata.Tokens.paper).padding(60)
                }
            }
        }
        .task { await load() }
        .onChange(of: selectedSeason) { _, new in
            guard let new else { return }
            Task { await loadEpisodes(seasonId: new.id) }
        }
    }

    private func hero(item: BaseItem) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            OpusBadge(key: id)
            Text(item.displayTitle)
                .font(.fraunces(heroTitleSize(for: item.displayTitle),
                                opticalSize: 144, soft: 30))
                .foregroundStyle(Strata.Tokens.paper)
                .minimumScaleFactor(0.5)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            MetadataRow(item: item, extraChips: seasons.isEmpty ? [] : ["\(seasons.count) SEASONS"])
            if let overview = item.overview {
                Text(overview)
                    .font(.plex(15))
                    .foregroundStyle(Strata.Tokens.paper.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 720, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func heroTitleSize(for text: String) -> CGFloat {
        text.count > 18 ? 36 : 44
    }

    private var actionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                if let firstEpisode = episodes.first {
                    PrimaryButton(playLabel(firstEpisode), systemImage: "play.fill") {
                        services.coordinator.requestWatch(firstEpisode.id, start: firstEpisode.resumePositionSeconds)
                    }
                }
                WatchlistButton(itemId: id, isFavorite: $isFavorite, client: services.client)
            }
        }
    }

    private func playLabel(_ episode: BaseItem) -> String {
        let season = episode.parentIndexNumber ?? 1
        let epNum = episode.indexNumber ?? 1
        return String(format: "Play S%02d·E%02d", season, epNum)
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
                        if let url = services.images?.thumb(itemId: ep.id) {
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
                            if let overview = ep.overview {
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
            Log.detail.warning("ShowDetailView.load \(id, privacy: .public) — no client")
            return
        }
        Log.detail.info("ShowDetailView.load enter \(id, privacy: .public)")
        async let i = try? await client.getItem(id)
        async let s = try? await client.getSeasons(seriesId: id)
        async let sim = (try? await client.getSimilarItems(itemId: id, limit: 12)) ?? []
        let fetchedItem = await i
        let fetchedSeasons = await s ?? []
        let fetchedSimilar = await sim
        Log.detail.info("ShowDetailView.load ok \(id, privacy: .public) seasons=\(fetchedSeasons.count, privacy: .public) similar=\(fetchedSimilar.count, privacy: .public)")
        item = fetchedItem
        seasons = fetchedSeasons
        similar = fetchedSimilar
        isFavorite = fetchedItem?.userData?.isFavorite ?? false
        if let first = seasons.first {
            selectedSeason = first
            await loadEpisodes(seasonId: first.id)
        }
    }

    private func loadEpisodes(seasonId: String) async {
        guard let client = services.client else { return }
        episodes = (try? await client.getEpisodes(seriesId: id, seasonId: seasonId)) ?? []
    }
}
