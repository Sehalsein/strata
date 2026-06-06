import Foundation

/// Small in-memory cache of raw GET response bodies with a short TTL. Backs the
/// "don't re-fetch the whole library every time a tab reappears" behaviour:
/// SwiftUI re-runs `.task` on every reappear, so without this a Home→Movies→Home
/// hop fires three full requests each way. Keyed by absolute request URL.
///
/// Deliberately simple: a flat TTL and a coarse count cap. Mutations (favorite
/// toggles, etc.) call `clear()` so stale list state can't linger.
actor ResponseCache {
    static let shared = ResponseCache()

    private struct Entry {
        let data: Data
        let expires: Date
    }

    private var store: [String: Entry] = [:]
    private let ttl: TimeInterval = 60
    private let maxEntries = 256

    func data(for key: String, now: Date) -> Data? {
        guard let entry = store[key] else { return nil }
        guard entry.expires > now else {
            store[key] = nil
            return nil
        }
        return entry.data
    }

    func store(_ data: Data, for key: String, now: Date) {
        // Coarse eviction: when full, drop everything rather than track LRU.
        // The TTL is short enough that a full flush is cheap and rare.
        if store.count >= maxEntries { store.removeAll(keepingCapacity: true) }
        store[key] = Entry(data: data, expires: now.addingTimeInterval(ttl))
    }

    func clear() {
        store.removeAll(keepingCapacity: false)
    }
}
