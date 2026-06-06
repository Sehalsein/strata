import SwiftUI
import StrataKit
import StrataDesign
import os

/// Detail page for a Jellyfin collection (BoxSet). Mirrors ShowDetailView's
/// editorial shape: ambient wash, a hero header (collections carry no
/// runtime / rating / year, so we show a count instead of a MetadataRow),
/// and a grid of the contained titles.
public struct CollectionDetailView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    public let id: String

    @State private var state: Loadable<BaseItem> = .idle
    @State private var films: [BaseItem] = []

    public init(id: String, path: Binding<[Route]>) {
        self.id = id
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: id, intensity: 0.95)
            AsyncContent(state, retry: { Task { await load() } }) { item in
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        hero(item: item)
                        if !films.isEmpty {
                            PosterGrid(items: films, images: services.images) { picked in
                                if picked.type == .boxSet {
                                    path.append(.collection(id: picked.id))
                                } else {
                                    path.append(.unified(id: picked.id))
                                }
                            }
                        } else {
                            Text("No titles in this collection.")
                                .font(.plex(14))
                                .foregroundStyle(Strata.Tokens.paperDim)
                                .padding(.top, 40)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 40)
                    .padding(.bottom, CGFloat.strataScrollBottom)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .task { await load() }
    }

    private func hero(item: BaseItem) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            OpusBadge(key: id)
            Text(item.displayTitle)
                .font(.fraunces(item.displayTitle.count > 18 ? 36 : 44,
                                opticalSize: 144, soft: 30))
                .foregroundStyle(Strata.Tokens.paper)
                .minimumScaleFactor(0.5)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Chip("Collection", variant: .solid)
                Chip("\(films.count) Films", variant: .outline)
            }
            if let overview = item.overview, !overview.isEmpty {
                Text(overview)
                    .font(.plex(15))
                    .foregroundStyle(Strata.Tokens.paper.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 720, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func load() async {
        guard let client = services.client else {
            state = .failed("Not signed in")
            return
        }
        if state.value == nil { state = .loading }
        async let filmsTask = (try? await client.getCollectionItems(collectionId: id)) ?? []
        let result = await loadable { try await client.getItem(id) }
        state = result
        films = await filmsTask
    }
}
