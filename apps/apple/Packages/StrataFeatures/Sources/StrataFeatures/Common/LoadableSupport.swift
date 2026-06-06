import Foundation
import StrataDesign
import StrataKit

/// Runs an async load and maps the result into a `Loadable`, translating
/// `JellyfinClient.RequestError` into its human-readable `.message`. Task
/// cancellation (view disappeared) is treated as benign and leaves the caller
/// to keep its prior state.
@MainActor
func loadable<T>(_ work: () async throws -> T) async -> Loadable<T> {
    do {
        return .loaded(try await work())
    } catch is CancellationError {
        return .loading
    } catch let urlError as URLError where urlError.code == .cancelled {
        return .loading
    } catch let reqError as JellyfinClient.RequestError {
        return .failed(reqError.message)
    } catch {
        return .failed((error as NSError).localizedDescription)
    }
}

/// The route a tapped library item should push, by kind. Centralises the
/// boxSet → collection / series → show / default → movie branching that was
/// copy-pasted across every grid and shelf.
func defaultRoute(for item: BaseItem) -> Route {
    switch item.type {
    case .boxSet: return .collection(id: item.id)
    case .series: return .show(id: item.id)
    case .episode: return .show(id: item.seriesId ?? item.id)
    default: return .movie(id: item.id)
    }
}
