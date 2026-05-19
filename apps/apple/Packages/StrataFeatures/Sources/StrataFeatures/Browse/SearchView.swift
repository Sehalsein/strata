import SwiftUI
import StrataKit
import StrataDesign

public struct SearchView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    let initialQuery: String?
    @State private var term: String = ""
    @State private var movies: [BaseItem] = []
    @State private var shows: [BaseItem] = []
    @State private var searchTask: Task<Void, Never>?

    public init(path: Binding<[Route]>, initialQuery: String? = nil) {
        self._path = path
        self.initialQuery = initialQuery
    }

    public var body: some View {
        ZStack {
            AmbientBackdrop(key: "search", intensity: 0.6)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("SEARCH").strataSpec()
                    TextField("Title, year, genre…", text: $term)
                        .font(.fraunces(28, opticalSize: 96, soft: 50, wonk: 0))
                        .foregroundStyle(Strata.Tokens.paper)
                        .tint(Strata.Tokens.accent)
                        .padding(.vertical, 8)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
                        }
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .onChange(of: term) { _, _ in scheduleSearch() }

                    if !movies.isEmpty {
                        Shelf(title: "Films", items: movies, images: services.images) { item in
                            path.append(.movie(id: item.id))
                        }
                    }
                    if !shows.isEmpty {
                        Shelf(title: "Series", items: shows, images: services.images) { item in
                            path.append(.show(id: item.id))
                        }
                    }
                    Spacer(minLength: 60)
                }
                .padding(.horizontal, 28)
                .padding(.top, 32)
            }
        }
        .onAppear {
            if term.isEmpty, let q = initialQuery, !q.isEmpty {
                term = q
            }
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        let snapshot = term
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            await runSearch(snapshot)
        }
    }

    private func runSearch(_ q: String) async {
        guard let client = services.client else { return }
        let result = (try? await client.search(q)) ?? (movies: [], shows: [])
        await MainActor.run {
            self.movies = result.movies
            self.shows = result.shows
        }
    }
}
