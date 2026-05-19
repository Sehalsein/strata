import SwiftUI
import StrataKit
import StrataDesign
import os

public struct MovieDetailView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    public let id: String

    @State private var item: BaseItem?
    @State private var isLoading = true

    public init(id: String, path: Binding<[Route]>) {
        self.id = id
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: id, intensity: 1.0)
            if let item {
                detail(item: item)
                    .handoffForViewing(item: item)
            } else if isLoading {
                ProgressView().tint(Strata.Tokens.paper)
            }
        }
        .task { await load() }
    }

    private func detail(item: BaseItem) -> some View {
        ScrollView {
            GeometryReader { geo in
                ZStack(alignment: .bottomLeading) {
                    if let url = services.images?.backdrop(itemId: id) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let img):
                                img.resizable().scaledToFill()
                                    .frame(width: geo.size.width, height: 460)
                                    .clipped()
                                    .overlay(
                                        LinearGradient(
                                            colors: [.clear, Strata.Tokens.bg],
                                            startPoint: .top, endPoint: .bottom
                                        )
                                    )
                            default:
                                Rectangle().fill(Strata.Tokens.bg2)
                                    .frame(width: geo.size.width, height: 460)
                            }
                        }
                        .frame(width: geo.size.width, height: 460)
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
                        HStack(spacing: 8) {
                            if let year = item.productionYear { Chip(String(year)) }
                            if let rating = item.officialRating { Chip(rating) }
                            if let minutes = item.runtimeSeconds.map({ Int($0/60) }) {
                                Chip("\(minutes) MIN")
                            }
                        }
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
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                    .padding(.top, 28)
                    .frame(width: geo.size.width, alignment: .leading)
                }
                .frame(width: geo.size.width, height: 460)
            }
            .frame(height: 460)

            VStack(alignment: .leading, spacing: 20) {
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
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let overview = item.overview {
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
                                Chip(g, variant: .outline)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 60)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .ignoresSafeArea(edges: .top)
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
            Log.detail.warning("MovieDetailView.load \(id, privacy: .public) — no client")
            return
        }
        Log.detail.info("MovieDetailView.load enter \(id, privacy: .public)")
        isLoading = true
        defer { isLoading = false }
        do {
            let fetched = try await client.getItem(id)
            Log.detail.info("MovieDetailView.load ok \(id, privacy: .public) type=\(fetched.type?.rawValue ?? "?", privacy: .public)")
            item = fetched
        } catch {
            Log.detail.error("MovieDetailView.load fail \(id, privacy: .public): \(String(describing: error), privacy: .public)")
        }
    }
}
