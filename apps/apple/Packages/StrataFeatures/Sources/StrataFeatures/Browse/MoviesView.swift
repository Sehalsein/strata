import SwiftUI
import StrataKit
import StrataDesign

public struct MoviesView: View {
    @Binding var path: [Route]

    public init(path: Binding<[Route]>) {
        self._path = path
    }

    public var body: some View {
        LibraryScreen(
            path: $path,
            spec: "FILMS",
            title: "The Library",
            countLabel: { items in "\(items.filter { $0.type == .movie }.count) Films" }
        ) { client, sort in
            try await client.listMovies(sort: sort)
        }
    }
}
