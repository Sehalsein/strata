import SwiftUI
import StrataKit
import StrataDesign

/// The user's favorited titles — the destination behind the bookmark button on
/// Home. Sorting is fixed (alphabetical) since the list is hand-curated.
struct MyListView: View {
    @Binding var path: [Route]

    var body: some View {
        LibraryScreen(
            path: $path,
            spec: "YOUR LIST",
            title: "Saved",
            supportsSort: false,
            countLabel: { $0.isEmpty ? nil : "\($0.count) Saved" }
        ) { client, _ in
            try await client.favorites()
        }
    }
}
