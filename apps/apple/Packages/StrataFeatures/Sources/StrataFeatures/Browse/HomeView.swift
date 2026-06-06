import SwiftUI
import StrataKit
import StrataDesign

public struct HomeView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]

    @State private var recent: [BaseItem] = []
    @State private var resume: [BaseItem] = []
    @State private var movies: [BaseItem] = []
    @State private var shows: [BaseItem] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var showSettings = false
    #if os(tvOS)
    @State private var showProfiles = false
    #endif

    public init(path: Binding<[Route]>) {
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: heroKey, intensity: 0.85)
            #if os(tvOS)
            tvBody
            #else
            standardBody
            #endif
        }
        .task { await load() }
    }

    // MARK: - Standard (iOS / iPadOS / macOS)

    private var standardBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                header
                if let loadError, isEverythingEmpty {
                    ErrorRetryView(message: loadError, retry: { Task { await reload() } })
                        .frame(minHeight: 340)
                } else {
                    shelves
                    if isLoading && isEverythingEmpty {
                        VStack(spacing: 16) {
                            SkeletonBlock(height: 120)
                            SkeletonBlock(height: 220)
                        }
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.top, 32)
            .padding(.bottom, CGFloat.strataScrollBottom)
        }
        #if !os(tvOS)
        .refreshable { await reload() }
        #endif
    }

    private var isEverythingEmpty: Bool {
        recent.isEmpty && resume.isEmpty && movies.isEmpty && shows.isEmpty
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
            HStack(spacing: 10) {
                Button {
                    path.append(.myList)
                } label: {
                    Image(systemName: "bookmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Strata.Tokens.paper)
                        .frame(width: 38, height: 38)
                        .background(Circle().fill(Strata.Tokens.paper.opacity(0.08)))
                        .overlay(Circle().stroke(Strata.Tokens.paperHair, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("My List")
                if let name = services.auth.session?.userName {
                    Button {
                        showSettings = true
                    } label: {
                        Chip(name, variant: .outline)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }

    // MARK: - tvOS billboard

    #if os(tvOS)
    private var tvBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 80) {
                if let feature = featuredItem {
                    HeroBillboard(item: feature, images: services.images) {
                        services.coordinator.requestWatch(feature.id, start: feature.resumePositionSeconds)
                    } onInfo: {
                        appendRoute(for: feature)
                    }
                } else if isLoading {
                    SkeletonBlock(height: 540)
                        .padding(.horizontal, 60)
                }

                VStack(alignment: .leading, spacing: 48) {
                    shelves
                }
                .padding(.horizontal, 60)

                if let name = services.auth.session?.userName {
                    tvAccountSection(name: name)
                }

                Spacer(minLength: 60)
            }
            .padding(.bottom, 40)
        }
        // Bleed the hero past tvOS's overscan safe area so the cover image
        // fills the screen edge-to-edge and extends behind the top tab bar,
        // matching the iPad billboard. Shelves keep their inner .padding(60).
        .ignoresSafeArea()
    }

    private var featuredItem: BaseItem? {
        resume.first ?? movies.first ?? shows.first
    }

    private func appendRoute(for item: BaseItem) {
        switch item.type {
        case .episode, .series: path.append(.show(id: item.id))
        default: path.append(.movie(id: item.id))
        }
    }

    private func tvAccountSection(name: String) -> some View {
        HStack(alignment: .center, spacing: 24) {
            if let session = services.auth.session {
                ProfileAvatar(session: session, size: 52)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("ACCOUNT")
                    .font(.mono(18, weight: .semibold)).tracking(3.2)
                    .foregroundStyle(Strata.Tokens.paperDim)
                Text("Signed in as \(name)")
                    .font(.plex(22))
                    .foregroundStyle(Strata.Tokens.paper)
            }
            Spacer()
            Button {
                path.append(.myList)
            } label: {
                Label("My List", systemImage: "bookmark")
                    .font(.plex(20, weight: .semibold))
            }
            Button {
                showSettings = true
            } label: {
                Label("Settings", systemImage: "gearshape")
                    .font(.plex(20, weight: .semibold))
            }
            Button {
                showProfiles = true
            } label: {
                Label("Switch Profile", systemImage: "person.2.fill")
                    .font(.plex(20, weight: .semibold))
            }
            Button {
                services.auth.signOut()
                services.refreshSessionDependentServices()
            } label: {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.plex(20, weight: .semibold))
            }
        }
        .padding(.horizontal, 60)
        .padding(.top, 32)
        .fullScreenCover(isPresented: $showProfiles) {
            ProfileGateView(onChosen: { showProfiles = false })
        }
        .fullScreenCover(isPresented: $showSettings) {
            SettingsView()
        }
    }
    #endif

    // MARK: - Shelves (shared)

    @ViewBuilder
    private var shelves: some View {
        if !resume.isEmpty {
            Shelf(title: "Continue Watching", items: resume, images: services.images) { item in
                path.append(.watch(.init(itemId: item.id, startSeconds: item.resumePositionSeconds)))
            }
        }
        if !recent.isEmpty {
            Shelf(title: "Recently Added", items: recent, images: services.images) { item in
                path.append(defaultRoute(for: item))
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
    }

    private var heroKey: String? {
        resume.first?.id ?? movies.first?.id ?? shows.first?.id
    }

    /// Pull-to-refresh: drop cached responses so the reload genuinely re-hits
    /// the server.
    private func reload() async {
        await JellyfinClient.clearResponseCache()
        await load()
    }

    private func load() async {
        guard let client = services.client else { return }
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            async let recentT = client.recentlyAdded(limit: 20)
            async let resumeT = client.continueWatching()
            async let moviesT = client.listMovies(limit: 20)
            async let showsT = client.listShows(limit: 20)
            recent = try await recentT
            resume = try await resumeT
            movies = try await moviesT
            shows = try await showsT
            // Push everything into Spotlight so the user can launch a title
            // from system search. Spotlight dedupes by `uniqueIdentifier`.
            Spotlight.index(items: movies + shows, images: services.images)
        } catch let error as JellyfinClient.RequestError {
            loadError = error.message
        } catch {
            loadError = (error as NSError).localizedDescription
        }
    }
}

#if os(tvOS)

/// Editorial hero billboard for tvOS Home. Mirrors the web's "Tonight in
/// Repertory" layout: red-dot overline, oversize Fraunces title, metadata
/// row, italic tagline, and the editorial BEGIN / PROGRAMME CTAs.
private struct HeroBillboard: View {
    let item: BaseItem
    let images: ImageURLBuilder?
    let onPlay: () -> Void
    let onInfo: () -> Void

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            backdrop
            scrim
            content
                .padding(.leading, 100)
                .padding(.trailing, 100)
                .padding(.bottom, 180)
        }
        .frame(height: 880)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    private var backdrop: some View {
        ZStack {
            // Procedural motif so the slot is filled before — and after — the
            // network image resolves.
            Motif(
                key: StrataTheme.motif(for: item.id),
                palette: StrataTheme.palette(for: item.id)
            )
            if let url = images?.backdrop(itemId: item.id, maxWidth: 2400) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                            .transition(.opacity.animation(.easeInOut(duration: 0.6)))
                    default:
                        EmptyView()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private var scrim: some View {
        ZStack {
            // Heavier bottom-to-top ink wash so the title/metadata always
            // reads on top of bright backdrops.
            LinearGradient(
                colors: [Strata.Tokens.bg.opacity(0.0),
                         Strata.Tokens.bg.opacity(0.25),
                         Strata.Tokens.bg.opacity(0.85),
                         Strata.Tokens.bg],
                startPoint: .top, endPoint: .bottom
            )
            LinearGradient(
                colors: [Strata.Tokens.bg.opacity(0.85),
                         Strata.Tokens.bg.opacity(0.35),
                         .clear],
                startPoint: .leading, endPoint: .trailing
            )
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 22) {
            overline
            Text(item.displayTitle)
                .font(.fraunces(96, opticalSize: 144, soft: 40, wonk: 1))
                .foregroundStyle(Strata.Tokens.paper)
                .lineLimit(2)
                .minimumScaleFactor(0.45)
                .frame(maxWidth: 1100, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            metadata
            if let blurb = blurb {
                Text(blurb)
                    .font(.fraunces(22, opticalSize: 36, soft: 100))
                    .italic()
                    .foregroundStyle(Strata.Tokens.paperDim)
                    .lineLimit(2)
                    .frame(maxWidth: 860, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 20) {
                PrimaryButton(playLabel, systemImage: "play.fill", action: onPlay)
                SecondaryButton("Programme", systemImage: "info.circle", action: onInfo)
            }
            .padding(.top, 12)
        }
    }

    private var overline: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(Strata.Tokens.accent)
                .frame(width: 10, height: 10)
            Text("TONIGHT IN REPERTORY")
                .font(.mono(14, weight: .semibold))
                .tracking(3.4)
                .foregroundStyle(Strata.Tokens.paper)
        }
    }

    private var metadata: some View {
        HStack(spacing: 14) {
            ForEach(Array(metadataParts.enumerated()), id: \.offset) { idx, part in
                if idx > 0 {
                    Circle()
                        .fill(Strata.Tokens.paperFaint)
                        .frame(width: 4, height: 4)
                }
                part
            }
        }
        .font(.mono(13))
        .tracking(2.0)
        .foregroundStyle(Strata.Tokens.paperDim)
    }

    /// Builds the bullet-separated row: year · runtime · type · rating.
    private var metadataParts: [AnyView] {
        var parts: [AnyView] = []
        if let year = item.productionYear {
            parts.append(AnyView(Text(String(year))))
        }
        if let runtime = runtimeLabel {
            parts.append(AnyView(Text(runtime)))
        }
        parts.append(AnyView(
            Text(kindLabel)
                .italic()
                .font(.fraunces(14, opticalSize: 24, soft: 100))
        ))
        if let rating = item.officialRating, !rating.isEmpty {
            parts.append(AnyView(Text(rating)))
        }
        return parts
    }

    private var runtimeLabel: String? {
        guard let secs = item.runtimeSeconds, secs > 0 else { return nil }
        let total = Int(secs)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 {
            return minutes > 0 ? "\(hours)H \(minutes)M" : "\(hours)H"
        }
        return "\(minutes)M"
    }

    private var kindLabel: String {
        switch item.type {
        case .series, .season, .episode: return "a series"
        default: return "a motion picture"
        }
    }

    private var playLabel: String {
        item.resumePositionSeconds == nil ? "Begin" : "Resume"
    }

    private var blurb: String? {
        if let line = item.taglines?.first, !line.isEmpty { return line }
        if let overview = item.overview, !overview.isEmpty { return overview }
        return nil
    }
}

#endif
