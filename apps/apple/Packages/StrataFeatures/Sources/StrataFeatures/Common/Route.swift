import Foundation
import StrataKit

public enum AppSection: String, Hashable, CaseIterable, Identifiable {
    case home, movies, shows, search
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .home: return "Home"
        case .movies: return "Movies"
        case .shows: return "Shows"
        case .search: return "Search"
        }
    }
    public var systemImage: String {
        switch self {
        case .home: return "house"
        case .movies: return "film"
        case .shows: return "tv"
        case .search: return "magnifyingglass"
        }
    }
}

public enum Route: Hashable {
    case movie(id: String)
    case show(id: String)
    case unified(id: String)
    case collection(id: String)
    case season(seriesId: String, seasonId: String, seriesName: String)
    case watch(WatchRequest)
    case search(query: String?)
    /// Browse a single genre. `forShows` selects the item types queried.
    case genre(name: String, forShows: Bool)
    /// The user's favorited items ("My List").
    case myList
}

public struct WatchRequest: Hashable, Codable, Sendable {
    public let itemId: String
    public let startSeconds: TimeInterval?

    public init(itemId: String, startSeconds: TimeInterval? = nil) {
        self.itemId = itemId
        self.startSeconds = startSeconds
    }
}
