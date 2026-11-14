#if os(iOS)
import Foundation
import Observation

/// Titles downloaded to watch offline (iPhone and iPad; Apple TV has no lasting storage).
///
/// A download is the original file, fetched by a background `URLSession` so it carries on
/// with the app closed, and played through the same on-device engine as a stream. Files
/// live in Application Support, kept out of iCloud backups; a manifest beside them says
/// what each is. Each belongs to the profile (sign-in) that asked for it.
@MainActor
@Observable
public final class DownloadStore {
    public static let shared = DownloadStore()

    public private(set) var items: [DownloadItem] = []
    /// Downloads use Wi-Fi only unless this is on.
    public var allowsCellular: Bool {
        didSet { UserDefaults.standard.set(allowsCellular, forKey: Self.cellularKey) }
    }

    /// The client for a sign-in, to refresh an expired link (set by the app).
    @ObservationIgnored public var clientFor: (@MainActor (String) -> StrataClient?)?
    /// Called by the system when background downloads finish while the app was away. Each
    /// one handed in is kept (there are two sessions) and called once events are handled.
    @ObservationIgnored public var backgroundCompletion: (() -> Void)? {
        get { completions.last }
        set { if let newValue { completions.append(newValue) } }
    }
    @ObservationIgnored private var completions: [() -> Void] = []

    static let sessionIdentifier = "app.strata.downloads"
    /// The same downloads, Wi-Fi only. Cellular is allowed or not by the session a task runs
    /// in: a request's own setting is baked into resume data, so a resumed download would
    /// keep whatever was chosen when it began.
    static let wifiSessionIdentifier = "app.strata.downloads.wifi"
    private static let cellularKey = "strata.downloadsOnCellular"
    nonisolated static let folder: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = dir
        try? url.setResourceValues(values)
        return dir
    }()
    private var manifestURL: URL { Self.folder.appendingPathComponent("manifest.json") }

    @ObservationIgnored private var session: URLSession!
    @ObservationIgnored private var wifiSession: URLSession!
    /// The session new and resumed downloads go to, as the cellular setting says.
    private var currentSession: URLSession { allowsCellular ? session : wifiSession }
    @ObservationIgnored private let delegate = SessionDelegate()
    @ObservationIgnored private var tasks: [String: URLSessionDownloadTask] = [:]
    @ObservationIgnored private var lastSave = Date.distantPast
    /// When each download's progress last reached `items` (see `progressed`).
    @ObservationIgnored private var lastProgress: [String: Date] = [:]
    /// Links refreshed per download, so a link that keeps failing can't loop forever.
    @ObservationIgnored private var refreshes: [String: Int] = [:]

    private init() {
        allowsCellular = UserDefaults.standard.bool(forKey: Self.cellularKey)
        items = (try? JSONDecoder().decode([DownloadItem].self, from: Data(contentsOf: manifestURL))) ?? []
        delegate.store = self
        func make(_ identifier: String, cellular: Bool) -> URLSession {
            let config = URLSessionConfiguration.background(withIdentifier: identifier)
            config.sessionSendsLaunchEvents = true
            config.isDiscretionary = false
            config.allowsCellularAccess = cellular
            return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        }
        session = make(Self.sessionIdentifier, cellular: true)
        wifiSession = make(Self.wifiSessionIdentifier, cellular: false)
        // Re-attach to downloads that carried on while the app was closed (in either session).
        let sessions: [URLSession] = [session, wifiSession]
        Task {
            var found: [(String, URLSessionDownloadTask)] = []
            for session in sessions {
                for task in await session.allTasks {
                    guard let download = task as? URLSessionDownloadTask, let description = download.taskDescription else { continue }
                    found.append((Self.itemID(description), download))
                }
            }
            for (id, task) in found { self.tasks[id] = task }
            for i in self.items.indices where self.items[i].state == .downloading && self.tasks[self.items[i].id] == nil {
                self.items[i].state = .paused
            }
            self.save()
        }
    }

    // MARK: - Reading

    /// The downloads `signInID` can see, newest first.
    public func items(for signInID: String?) -> [DownloadItem] {
        items.filter { $0.signInID == signInID }.sorted { $0.createdAt > $1.createdAt }
    }

    public func item(signInID: String?, target: PlaybackTarget) -> DownloadItem? {
        guard let signInID else { return nil }
        return items.first { $0.id == DownloadItem.id(signInID: signInID, target: target) }
    }

    public func item(id: String) -> DownloadItem? { items.first { $0.id == id } }

    /// Where a finished download's file is.
    public func fileURL(for item: DownloadItem) -> URL? {
        guard item.isDone, let name = item.fileName else { return nil }
        let url = Self.folder.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Space the finished downloads take, in bytes.
    public var bytesUsed: Int64 {
        items.reduce(0) { total, item in
            guard let url = fileURL(for: item), let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return total }
            return total + Int64(size)
        }
    }

    /// Free space for new downloads, in bytes.
    public static var freeSpace: Int64? {
        let values = try? folder.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage
    }

    // MARK: - Changing

    /// Starts downloading `response`'s file for `signInID` (replacing an earlier download of the title).
    public func start(signInID: String, target: PlaybackTarget, title: String, subtitle: String?, artworkURL: URL?,
                      response: DownloadResponse, client: StrataClient) {
        var item = DownloadItem(signInID: signInID, target: target, title: title, subtitle: subtitle, artworkURL: artworkURL, response: response)
        if let old = self.item(id: item.id) { remove(old) }
        item.fileName = Self.fileName(item)
        items.append(item)
        refreshes[item.id] = 0
        begin(item, request: client.downloadRequest(response.url))
        save()
    }

    public func pause(_ item: DownloadItem) {
        guard let task = tasks[item.id] else { return }
        update(item.id) { $0.state = .paused }
        task.cancel { data in
            guard let data else { return }
            try? data.write(to: Self.resumeURL(item.id))
        }
        tasks[item.id] = nil
        save()
    }

    /// Carries on from where it stopped, or with a fresh link when that can't work.
    public func resume(_ item: DownloadItem) {
        guard tasks[item.id] == nil, !item.isDone else { return }
        update(item.id) { $0.state = .downloading }
        if let data = try? Data(contentsOf: Self.resumeURL(item.id)) {
            try? FileManager.default.removeItem(at: Self.resumeURL(item.id))
            let task = currentSession.downloadTask(withResumeData: data)
            task.taskDescription = Self.taskDescription(item)
            tasks[item.id] = task
            task.resume()
        } else {
            Task { await restartWithFreshLink(item.id) }
        }
        save()
    }

    /// Deletes a download and its file.
    public func remove(_ item: DownloadItem) {
        tasks[item.id]?.cancel()
        tasks[item.id] = nil
        if let name = item.fileName { try? FileManager.default.removeItem(at: Self.folder.appendingPathComponent(name)) }
        try? FileManager.default.removeItem(at: Self.resumeURL(item.id))
        items.removeAll { $0.id == item.id }
        save()
    }

    /// Deletes every download on this device (all profiles).
    public func removeAll() {
        for item in items { remove(item) }
    }

    /// Where a download was left, watched offline.
    public func setPosition(_ item: DownloadItem, ms: Int) {
        update(item.id) { $0.positionMs = ms }
        if Date().timeIntervalSince(lastSave) > 10 { save() }
    }

    // MARK: - Session events

    private func begin(_ item: DownloadItem, request: URLRequest) {
        // Allowed here; the session decides (see `wifiSessionIdentifier`).
        var request = request
        request.allowsCellularAccess = true
        let task = currentSession.downloadTask(with: request)
        task.taskDescription = Self.taskDescription(item)
        tasks[item.id] = task
        task.resume()
    }

    private func restartWithFreshLink(_ id: String) async {
        guard let item = item(id: id) else { return }
        let count = refreshes[id, default: 0]
        guard count < 3, let client = clientFor?(item.signInID) else {
            update(id) { $0.state = .failed(String(localized: "The download's link stopped working. Connect to your server and try again.", bundle: .module)) }
            save()
            return
        }
        refreshes[id] = count + 1
        do {
            let url = try await client.fileLink(fileId: item.response.fileId)
            update(id) {
                $0.response.url = url
                $0.state = .downloading
                $0.bytesWritten = 0
            }
            if let fresh = self.item(id: id) { begin(fresh, request: client.downloadRequest(url)) }
        } catch {
            update(id) { $0.state = .failed(StrataError.wrap(error).message) }
        }
        save()
    }

    fileprivate func progressed(_ id: String, written: Int64, expected: Int64) {
        // Once a second at most: every change redraws the pages that show the item.
        let now = Date()
        if let last = lastProgress[id], now.timeIntervalSince(last) < 1 { return }
        lastProgress[id] = now
        update(id) {
            $0.bytesWritten = written
            if expected > 0 { $0.bytesExpected = expected }
        }
        if Date().timeIntervalSince(lastSave) > 5 { save() }
    }

    fileprivate func finished(_ id: String, status: Int, moved: Bool) {
        tasks[id] = nil
        lastProgress[id] = nil
        if moved {
            update(id) {
                $0.state = .done
                $0.bytesWritten = max($0.bytesWritten, $0.bytesExpected)
            }
            refreshes[id] = nil
        } else if status == 403 || status == 404 || status == 410 {
            // The link expired: ask the server for a fresh one.
            Task { await restartWithFreshLink(id) }
        } else {
            update(id) { $0.state = .failed(String(localized: "The download failed (HTTP \(status)).", bundle: .module)) }
        }
        save()
    }

    fileprivate func failed(_ id: String, error: Error, resumeData: Data?) {
        tasks[id] = nil
        guard item(id: id)?.state == .downloading else { return } // paused or removed on purpose
        if let resumeData {
            try? resumeData.write(to: Self.resumeURL(id))
            update(id) { $0.state = .paused }
        } else {
            update(id) { $0.state = .failed(StrataError.wrap(error).message) }
        }
        save()
    }

    fileprivate func finishedBackgroundEvents() {
        let pending = completions
        completions = []
        pending.forEach { $0() }
    }

    private func update(_ id: String, _ change: (inout DownloadItem) -> Void) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[i])
    }

    /// Encodes and writes the manifest off the main actor, in order.
    private func save() {
        lastSave = Date()
        let snapshot = items
        let url = manifestURL
        Self.saveQueue.async {
            try? JSONEncoder().encode(snapshot).write(to: url, options: .atomic)
        }
    }

    nonisolated private static let saveQueue = DispatchQueue(label: "strata.downloads.manifest", qos: .utility)

    // MARK: - Names

    /// A file name for the item's id (which has colons) and the source's extension.
    nonisolated static func fileName(_ item: DownloadItem) -> String {
        let safe = item.id.map { $0.isLetter || $0.isNumber || $0 == "-" ? String($0) : "_" }.joined()
        return "\(safe).\(item.fileExtension)"
    }

    nonisolated static func taskDescription(_ item: DownloadItem) -> String { "\(item.id)|\(fileName(item))" }
    nonisolated static func itemID(_ description: String) -> String { String(description.split(separator: "|").first ?? "") }
    nonisolated static func resumeURL(_ id: String) -> URL {
        folder.appendingPathComponent(id.map { $0.isLetter || $0.isNumber ? String($0) : "_" }.joined() + ".resume")
    }
}

/// The background session's delegate: moves finished files into place (it must, before
/// returning) and tells the store.
private final class SessionDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    weak var store: DownloadStore?

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let description = downloadTask.taskDescription else { return }
        let id = DownloadStore.itemID(description)
        Task { @MainActor [weak store] in store?.progressed(id, written: totalBytesWritten, expected: totalBytesExpectedToWrite) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let description = downloadTask.taskDescription else { return }
        let parts = description.split(separator: "|")
        let id = String(parts.first ?? "")
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        var moved = false
        if (200..<300).contains(status), parts.count == 2 {
            let destination = DownloadStore.folder.appendingPathComponent(String(parts[1]))
            try? FileManager.default.removeItem(at: destination)
            moved = (try? FileManager.default.moveItem(at: location, to: destination)) != nil
        }
        Task { @MainActor [weak store] in store?.finished(id, status: status, moved: moved) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let description = task.taskDescription else { return }
        let id = DownloadStore.itemID(description)
        let resumeData = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        Task { @MainActor [weak store] in store?.failed(id, error: error, resumeData: resumeData) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor [weak store] in store?.finishedBackgroundEvents() }
    }
}
#endif
