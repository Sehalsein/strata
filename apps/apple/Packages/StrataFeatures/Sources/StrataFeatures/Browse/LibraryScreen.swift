import SwiftUI
import StrataKit
import StrataDesign

/// One grid-of-posters screen, reused for Movies, Shows, a single genre, and
/// My List. Owns its `Loadable` state, an optional sort control, error/retry,
/// and the default tap-routing — so each concrete screen is just a title plus a
/// loader closure. Replaces the near-identical bodies that used to live in
/// MoviesView / ShowsView.
struct LibraryScreen: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]

    let spec: String
    let title: String
    let supportsSort: Bool
    let countLabel: (([BaseItem]) -> String?)?
    let loader: (JellyfinClient, JellyfinClient.ItemSort) async throws -> [BaseItem]

    @State private var state: Loadable<[BaseItem]> = .idle
    @State private var sort: JellyfinClient.ItemSort = .recentlyAdded

    init(
        path: Binding<[Route]>,
        spec: String,
        title: String,
        supportsSort: Bool = true,
        countLabel: (([BaseItem]) -> String?)? = nil,
        loader: @escaping (JellyfinClient, JellyfinClient.ItemSort) async throws -> [BaseItem]
    ) {
        self._path = path
        self.spec = spec
        self.title = title
        self.supportsSort = supportsSort
        self.countLabel = countLabel
        self.loader = loader
    }

    var body: some View {
        ZStack {
            AmbientBackdrop(key: state.value?.first?.id, intensity: 0.7)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    AsyncContent(state, retry: { Task { await reload() } }) { items in
                        if items.isEmpty {
                            emptyState
                        } else {
                            PosterGrid(items: items, images: services.images) { item in
                                path.append(defaultRoute(for: item))
                            }
                        }
                    }
                }
                .padding(.horizontal, 28)
                .padding(.top, 32)
                .padding(.bottom, CGFloat.strataScrollBottom)
            }
        }
        .task { await loadIfNeeded() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(spec).strataSpec()
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.fraunces(36, opticalSize: 144, soft: 50))
                    .foregroundStyle(Strata.Tokens.paper)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Spacer()
                if let label = countLabel?(state.value ?? []) {
                    Chip(label, variant: .outline)
                }
                if supportsSort { sortMenu }
            }
        }
    }

    private var sortMenu: some View {
        Menu {
            ForEach(JellyfinClient.ItemSort.Field.allCases, id: \.self) { field in
                Button { setSort(field: field) } label: {
                    if sort.field == field {
                        Label(field.label,
                              systemImage: sort.order == .ascending ? "chevron.up" : "chevron.down")
                    } else {
                        Text(field.label)
                    }
                }
            }
        } label: {
            Image(systemName: "arrow.up.arrow.down")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Strata.Tokens.paper)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Strata.Tokens.paper.opacity(0.08)))
                .overlay(Circle().stroke(Strata.Tokens.paperHair, lineWidth: 1))
        }
        .accessibilityLabel("Sort")
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Strata.Tokens.paperDim)
            Text("Nothing here yet.")
                .font(.plex(14))
                .foregroundStyle(Strata.Tokens.paperDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }

    private func setSort(field: JellyfinClient.ItemSort.Field) {
        if sort.field == field {
            sort.order = (sort.order == .ascending) ? .descending : .ascending
        } else {
            // Titles read best ascending; everything else newest/highest first.
            sort = JellyfinClient.ItemSort(field: field, order: field == .title ? .ascending : .descending)
        }
        Task { await reload() }
    }

    private func loadIfNeeded() async {
        if case .loaded = state { return }
        await reload()
    }

    private func reload() async {
        guard let client = services.client else {
            state = .failed("Not signed in")
            return
        }
        if state.value == nil { state = .loading }
        state = await loadable { try await loader(client, sort) }
    }
}
