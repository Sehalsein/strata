import SwiftUI
import StrataKit
import StrataDesign

public struct ShowsView: View {
    @Binding var path: [Route]

    public init(path: Binding<[Route]>) {
        self._path = path
    }

    public var body: some View {
        LibraryScreen(
            path: $path,
            spec: "SERIES",
            title: "The Catalogue",
            countLabel: { items in "\(items.count) Series" }
        ) { client, sort in
            try await client.listShows(sort: sort)
        }
    }
}
