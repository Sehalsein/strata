import SwiftUI
import StrataKit
import StrataDesign

public struct HomeView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]

    @State private var resume: [BaseItem] = []
    @State private var movies: [BaseItem] = []
    @State private var shows: [BaseItem] = []
    @State private var isLoading = true

    public init(path: Binding<[Route]>) {
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: heroKey, intensity: 0.85)
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    header
                    if !resume.isEmpty {
                        Shelf(title: "Continue Watching", items: resume, images: services.images) { item in
                            path.append(.watch(.init(itemId: item.id, startSeconds: item.resumePositionSeconds)))
                        }
                    }
                    if !movies.isEmpty {
                        Shelf(title: "Recent Films", items: movies, images: services.images) { item in
                            path.append(.movie(id: item.id))
                        }
                    }
                    if !shows.isEmpty {
                        Shelf(title: "Recent Series", items: shows, images: services.images) { item in
                            path.append(.show(id: item.id))
                        }
                    }
                    if isLoading {
                        VStack(spacing: 16) {
                            SkeletonBlock(height: 120)
                            SkeletonBlock(height: 220)
                        }
                    }
                    Spacer(minLength: 60)
                }
                .padding(.horizontal, 28)
                .padding(.top, 32)
            }
        }
        .task { await load() }
    }

    private var heroKey: String? {
        resume.first?.id ?? movies.first?.id ?? shows.first?.id
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                Text("STRATA").strataSpec()
                Text("Tonight's Programme")
                    .font(.fraunces(42, opticalSize: 144, soft: 50))
                    .foregroundStyle(Strata.Tokens.paper)
            }
            Spacer()
            if let name = services.auth.session?.userName {
                Chip(name, variant: .outline)
            }
        }
    }

    private func load() async {
        guard let client = services.client else { return }
        isLoading = true
        defer { isLoading = false }
        async let r = try? await client.continueWatching()
        async let m = try? await client.listMovies()
        async let s = try? await client.listShows()
        resume = await r ?? []
        movies = Array((await m ?? []).prefix(20))
        shows = Array((await s ?? []).prefix(20))
        // Push everything into Spotlight so the user can launch a title from
        // system search. Re-runs on every Home refresh — Spotlight dedupes
        // by `uniqueIdentifier`.
        Spotlight.index(items: movies + shows, images: services.images)
    }
}
