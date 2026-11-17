import Foundation

/// The filters you set in Choose Source, kept on this device per server, so the sheet opens
/// with them next time (on any title). A filter a title has no copies for is left unapplied
/// there but kept for the next one.
public final class SourceFilterMemory: @unchecked Sendable {
    public static let shared = SourceFilterMemory()

    /// One server's filters: the option picked in each of its groups (group id → option id),
    /// and for older servers that send no filters, the app's own quality filter.
    public struct Filters: Codable, Equatable, Sendable {
        public var picked: [String: String] = [:]
        public var quality: String?

        public init(picked: [String: String] = [:], quality: String? = nil) {
            self.picked = picked
            self.quality = quality
        }

        public var isEmpty: Bool { picked.isEmpty && quality == nil }
    }

    private let defaults: UserDefaults
    private let key = "strata.sourceFilters"
    private let lock = NSLock()

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func filters(server: URL) -> Filters {
        lock.withLock { load()[server.absoluteString] ?? Filters() }
    }

    /// Saves a server's filters; empty ones are forgotten.
    public func set(_ filters: Filters, server: URL) {
        lock.withLock {
            var all = load()
            all[server.absoluteString] = filters.isEmpty ? nil : filters
            if let data = try? JSONEncoder().encode(all) { defaults.set(data, forKey: key) }
        }
    }

    private func load() -> [String: Filters] {
        guard let data = defaults.data(forKey: key), let all = try? JSONDecoder().decode([String: Filters].self, from: data) else { return [:] }
        return all
    }
}

extension SourceList {
    /// Of the picked options, those this list offers: the ones that can apply to it.
    public func applicable(_ picked: [String: String]) -> [String: String] {
        picked.filter { group, option in filters.contains { $0.id == group && $0.options.contains { $0.id == option } } }
    }
}
