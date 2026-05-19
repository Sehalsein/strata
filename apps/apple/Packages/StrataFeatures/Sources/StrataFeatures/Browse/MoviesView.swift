import SwiftUI
import StrataKit
import StrataDesign

public struct MoviesView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    @State private var items: [BaseItem] = []
    @State private var isLoading = true

    public init(path: Binding<[Route]>) {
        self._path = path
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: items.first?.id, intensity: 0.7)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    if isLoading {
                        ProgressView().tint(Strata.Tokens.paper)
                    } else {
                        PosterGrid(items: items, images: services.images) { item in
                            path.append(.movie(id: item.id))
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("FILMS").strataSpec()
            HStack(alignment: .firstTextBaseline) {
                Text("The Library")
                    .font(.fraunces(36, opticalSize: 144, soft: 50))
                    .foregroundStyle(Strata.Tokens.paper)
                Spacer()
                Chip("\(items.count) Films", variant: .outline)
            }
        }
    }

    private func load() async {
        guard let client = services.client else { return }
        isLoading = true
        defer { isLoading = false }
        items = (try? await client.listMovies()) ?? []
    }
}
