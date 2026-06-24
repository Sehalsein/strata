import SwiftUI
import StrataKit
import StrataDesign
import os

public struct MovieDetailView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    public let id: String

    @State private var state: Loadable<BaseItem> = .idle
    @State private var similar: [BaseItem] = []
    @State private var isFavorite: Bool = false

    public init(id: String, path: Binding<[Route]>) {
        self.id = id
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: id, intensity: 1.0)
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
                        MetadataRow(item: item)
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
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        PrimaryButton(playLabel(item), systemImage: "play.fill") {
                            services.coordinator.requestWatch(id, start: item.resumePositionSeconds)
                        }
                        if let resume = item.resumePositionSeconds {
                            SecondaryButton("Restart", systemImage: "arrow.counterclockwise") {
                                services.coordinator.requestWatch(id, start: 0)
                            }
                            Text("RESUME \(format(resume))").strataSpec()
                        }
                        WatchlistButton(itemId: id, isFavorite: $isFavorite, client: services.client)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let overview = item.overviewText {
                    Text(overview)
                        .font(.plex(15))
                        .foregroundStyle(Strata.Tokens.paper.opacity(0.86))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 720, alignment: .leading)
                }
                if let genres = item.genres, !genres.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(genres.prefix(6).enumerated()), id: \.offset) { _, g in
                                Button { path.append(.genre(name: g, forShows: false)) } label: {
                                    Chip(g, variant: .outline)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
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
        // Bleed the hero into the top safe area, but keep the bottom inset so
        // content clears the tab bar / home indicator instead of hiding under
        // it. (tvOS has no tab bar at the bottom, so let it bleed fully.)
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

    private func playLabel(_ item: BaseItem) -> String {
        item.resumePositionSeconds == nil ? "Play" : "Resume"
    }

    /// Pick a hero title size that fits the device. The longer the title and
    /// the narrower the screen, the smaller the font. `minimumScaleFactor`
    /// + `lineLimit(3)` does the final adaptive squeeze.
    private func heroTitleSize(for width: CGFloat, text: String) -> CGFloat {
        if width < 420 {
            return text.count > 18 ? 34 : 42
        }
        if width < 720 { return 48 }
        return 56
    }

    private func format(_ t: TimeInterval) -> String {
        guard t.isFinite else { return "0:00" }
        let clamped = max(0, min(t, 24 * 3600))
        let mins = Int(clamped / 60)
        let secs = Int(clamped.truncatingRemainder(dividingBy: 60))
        return String(format: "%d:%02d", mins, secs)
    }

    private func load() async {
        guard let client = services.client else {
            state = .failed("Not signed in")
            return
        }
        if state.value == nil { state = .loading }
        // Similar items are secondary — load them alongside the main item so a
        // slow recommendations call never holds up the page.
        async let similarTask: [BaseItem] = (try? await client.getSimilarItems(itemId: id, limit: 12)) ?? []
        let result = await loadable { try await client.getItem(id) }
        state = result
        if case .loaded(let fetched) = result {
            isFavorite = fetched.userData?.isFavorite ?? false
        }
        similar = await similarTask
    }
}
