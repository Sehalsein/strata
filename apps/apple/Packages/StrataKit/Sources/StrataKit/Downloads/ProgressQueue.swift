import Foundation

/// Watch progress that couldn't reach the server (offline, or a download watched on a
/// plane), kept on disk and sent once the device is back online, so Continue Watching
/// stays right. Only the latest position per title is kept.
public actor ProgressQueue {
    public static let shared = ProgressQueue()

    struct Entry: Codable, Sendable {
        var signInID: String
        var target: PlaybackTarget
        var positionMs: Int
        var durationMs: Int
        var at: Date
    }

    private let url: URL
    private var entries: [Entry]

    init(url: URL = ProgressQueue.defaultURL) {
        self.url = url
        entries = (try? JSONDecoder().decode([Entry].self, from: Data(contentsOf: url))) ?? []
    }

    static var defaultURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("progress-queue.json")
    }

    public var isEmpty: Bool { entries.isEmpty }

    /// Keeps `positionMs` for `target` to send later (replacing an older one for it).
    public func enqueue(signInID: String, target: PlaybackTarget, positionMs: Int, durationMs: Int) {
        entries.removeAll { $0.signInID == signInID && $0.target == target }
        entries.append(Entry(signInID: signInID, target: target, positionMs: positionMs, durationMs: durationMs, at: Date()))
        save()
    }

    /// Sends what's kept for `signInID` with its client, oldest first. Stops at the first
    /// network failure (still offline); drops entries the server refuses outright.
    public func flush(client: StrataClient, signInID: String) async {
        for entry in entries where entry.signInID == signInID {
            do {
                try await client.reportProgress(entry.target, positionMs: entry.positionMs, durationMs: entry.durationMs)
            } catch {
                if StrataError.wrap(error).kind == .network { return }
            }
            entries.removeAll { $0.signInID == entry.signInID && $0.target == entry.target && $0.at == entry.at }
            save()
        }
    }

    private func save() {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(entries).write(to: url, options: .atomic)
    }
}
