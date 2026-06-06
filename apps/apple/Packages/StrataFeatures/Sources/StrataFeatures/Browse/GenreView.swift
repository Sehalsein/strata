import SwiftUI
import StrataKit
import StrataDesign

/// Browse one genre. Reached by tapping a genre chip on a detail page.
struct GenreView: View {
    @Binding var path: [Route]
    let name: String
    let forShows: Bool

    var body: some View {
        LibraryScreen(
            path: $path,
            spec: "GENRE",
            title: name,
            countLabel: { $0.isEmpty ? nil : "\($0.count) Titles" }
        ) { client, sort in
            if forShows {
                return try await client.listShows(sort: sort, genres: [name])
            } else {
                return try await client.listMovies(sort: sort, genres: [name])
            }
        }
    }
}
