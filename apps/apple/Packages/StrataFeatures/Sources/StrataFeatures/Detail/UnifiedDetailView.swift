import SwiftUI
import StrataKit
import StrataDesign
import os

/// Routes by item kind at fetch time. Useful for deep-link or Spotlight
/// entries where we know an id but not whether it's a movie or a series.
public struct UnifiedDetailView: View {
    @Environment(AppServices.self) private var services
    @Binding var path: [Route]
    public let id: String

    @State private var kind: ItemKind?
    @State private var loaded = false

    public init(id: String, path: Binding<[Route]>) {
        self.id = id
        self._path = path
    }

    public var body: some View {
        Group {
            if !loaded {
                ProgressView().tint(Strata.Tokens.paper)
            } else if kind == .series || kind == .season {
                ShowDetailView(id: id, path: $path)
            } else {
                MovieDetailView(id: id, path: $path)
            }
        }
        .task {
            guard let client = services.client else {
                Log.detail.warning("UnifiedDetailView.task \(id, privacy: .public) — no client")
                loaded = true
                return
            }
            Log.detail.info("UnifiedDetailView.task enter \(id, privacy: .public)")
            do {
                let item = try await client.getItem(id)
                kind = item.type
                Log.detail.info("UnifiedDetailView.task ok kind=\(item.type?.rawValue ?? "?", privacy: .public)")
            } catch {
                Log.detail.error("UnifiedDetailView.task fail: \(String(describing: error), privacy: .public)")
            }
            loaded = true
        }
    }
}
