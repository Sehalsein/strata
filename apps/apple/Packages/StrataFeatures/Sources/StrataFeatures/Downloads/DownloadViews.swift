#if os(iOS)
import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI

// Downloads (iPhone and iPad): the Download button on titles, the Downloads page, and
// what the app shows when it's offline.

extension AppServices {
    /// Asks the server for a title's file and starts downloading it for the profile in
    /// use. Returns a message to show when it can't.
    func download(_ target: PlaybackTarget, candidateId: String?, title: String, subtitle: String?, artworkURL: URL?) async -> String? {
        guard let client, let signInID = store.activeID else { return String(localized: "Not connected to a server.", bundle: .module) }
        var probed = Set<Int>()
        do {
            while true {
                switch try await client.prepareDownload(target, candidateId: candidateId) {
                case .ready(let response):
                    if let free = DownloadStore.freeSpace, Int64(response.candidate.size) > free {
                        let need = Formatting.size(bytes: response.candidate.size) ?? String(localized: "more space", bundle: .module)
                        let have = Formatting.size(bytes: Int(free)) ?? String(localized: "less", bundle: .module)
                        return String(localized: "This needs \(need) and the device has \(have) free. Pick a smaller source, or free up space.", bundle: .module)
                    }
                    DownloadStore.shared.start(signInID: signInID, target: target, title: title, subtitle: subtitle, artworkURL: artworkURL,
                                               response: response, client: client)
                    return nil
                case .preparing(let status):
                    return status.message ?? String(localized: "The server is getting this source ready. Try downloading it again in a few minutes.", bundle: .module)
                case .needsProbe(let fileId, let url):
                    // The server can't read files itself: read the file's details here, once.
                    guard probed.insert(fileId).inserted else { return String(localized: "The server couldn't use what this file holds. Pick another source.", bundle: .module) }
                    try await FileInfoReader.report(fileId: fileId, url: url, client: client)
                }
            }
        } catch {
            return StrataError.wrap(error).message
        }
    }

    /// Plays a finished download from the device.
    func play(_ item: DownloadItem, fromStart: Bool = false) {
        play(WatchRequest(target: item.target, meta: PlaybackMeta(title: item.title, subtitle: item.subtitle, artworkURL: item.artworkURL),
                          startMs: fromStart ? 0 : nil, downloadID: item.id))
    }
}

/// A title's Download button: "Download" (choosing the source, with sizes), its progress
/// while downloading, and a check once it's on the device.
struct DownloadButton: View {
    @Environment(AppServices.self) private var services
    let target: PlaybackTarget
    let title: String
    var subtitle: String?
    var artworkURL: URL?
    /// Sources the page already has.
    var known: [Candidate] = []

    @State private var choosing = false
    @State private var starting = false
    @State private var notice: String?

    private var item: DownloadItem? { DownloadStore.shared.item(signInID: services.store.activeID, target: target) }

    var body: some View {
        Group {
            if let item {
                Menu {
                    DownloadActions(item: item)
                } label: {
                    DownloadStateLabel(item: item)
                }
                .buttonStyle(.strataGlass)
            } else {
                GlassButton(starting ? "Starting…" : String(localized: "Download", bundle: .module), systemImage: "arrow.down.circle", iconOnly: !Metrics.isPadOrTV) { choosing = true }
                    .disabled(starting)
            }
        }
        .sheet(isPresented: $choosing) {
            SourcePickerSheet(target: target, title: title, known: known, purpose: .download) { candidate in
                start(candidate.id)
            }
        }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "OK", bundle: .module), role: .cancel) { notice = nil }
        }
    }

    private func start(_ candidateId: String) {
        starting = true
        Task {
            notice = await services.download(target, candidateId: candidateId, title: title, subtitle: subtitle, artworkURL: artworkURL)
            starting = false
        }
    }
}

/// A download's state as a small icon: a ring while downloading, a check when done.
struct DownloadStateLabel: View {
    let item: DownloadItem

    var body: some View {
        switch item.state {
        case .done:
            Label(String(localized: "Downloaded", bundle: .module), systemImage: "checkmark.circle.fill").labelStyle(.iconOnly)
        case .downloading:
            ProgressRing(fraction: item.progress).frame(width: 20, height: 20).accessibilityLabel(Text("Downloading, \(Int(item.progress * 100))%", bundle: .module))
        case .paused:
            Label(String(localized: "Paused", bundle: .module), systemImage: "pause.circle").labelStyle(.iconOnly)
        case .failed:
            Label(String(localized: "Download failed", bundle: .module), systemImage: "exclamationmark.circle").labelStyle(.iconOnly).foregroundStyle(Theme.danger)
        }
    }
}

/// What can be done with a download: play, pause or resume, try again, remove.
struct DownloadActions: View {
    @Environment(AppServices.self) private var services
    let item: DownloadItem

    var body: some View {
        let store = DownloadStore.shared
        switch item.state {
        case .done:
            Button { services.play(item) } label: { Label(String(localized: "Play Download", bundle: .module), systemImage: "play.fill") }
            if item.positionMs ?? 0 > 0 {
                Button { services.play(item, fromStart: true) } label: { Label(String(localized: "Play from Beginning", bundle: .module), systemImage: "arrow.counterclockwise") }
            }
        case .downloading:
            Button { store.pause(item) } label: { Label(String(localized: "Pause Download", bundle: .module), systemImage: "pause") }
        case .paused, .failed:
            Button { store.resume(item) } label: { Label(String(localized: "Resume Download", bundle: .module), systemImage: "arrow.down.circle") }
        }
        Button(role: .destructive) { store.remove(item) } label: {
            Label(item.isDone ? "Remove Download" : "Cancel Download", systemImage: "trash")
        }
    }
}

/// Downloaded and downloading titles for the profile in use: tap to play, swipe to delete.
struct DownloadsView: View {
    @Environment(AppServices.self) private var services

    private var items: [DownloadItem] { DownloadStore.shared.items(for: services.store.activeID) }

    var body: some View {
        Group {
            if items.isEmpty {
                MessageView(systemImage: "arrow.down.circle", title: String(localized: "No downloads", bundle: .module),
                            message: String(localized: "Download movies and episodes from their page to watch them without a connection.", bundle: .module))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(items) { item in
                        Button {
                            if item.isDone { services.play(item) }
                        } label: {
                            DownloadRow(item: item)
                        }
                        .buttonStyle(.plain)
                        .contextMenu { DownloadActions(item: item) }
                        .listRowBackground(Theme.surface1)
                    }
                    .onDelete { offsets in
                        for i in offsets { DownloadStore.shared.remove(items[i]) }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(Text("Downloads", bundle: .module))
    }
}

struct DownloadRow: View {
    let item: DownloadItem

    var body: some View {
        HStack(spacing: Metrics.space3) {
            ArtworkImage(url: item.artworkURL, aspectRatio: 16 / 9, seed: item.id, title: item.title, cornerRadius: Metrics.radiusSM)
                .frame(width: 120)
            VStack(alignment: .leading, spacing: Metrics.space1) {
                Text(item.title).font(.stHeadline).foregroundStyle(Theme.ink).lineLimit(2)
                if let subtitle = item.subtitle { Text(subtitle).font(.stFootnote).foregroundStyle(Theme.ink2).lineLimit(1) }
                Group {
                    switch item.state {
                    case .done:
                        Text([Formatting.size(bytes: Int(item.bytesExpected)), item.response.candidate.resolutionLabel].compactMap { $0 }.joined(separator: " · "))
                    case .downloading:
                        ProgressBar(item.progress).frame(maxWidth: 200)
                        Text("\(Formatting.size(bytes: Int(item.bytesWritten)) ?? "0") of \(Formatting.size(bytes: Int(item.bytesExpected)) ?? "?")", bundle: .module)
                    case .paused:
                        Text("Paused · \(Int(item.progress * 100))%", bundle: .module)
                    case .failed(let message):
                        Text(message).foregroundStyle(Theme.danger).lineLimit(2)
                    }
                }
                .font(.stFootnote).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            if item.isDone { Image(systemName: "play.circle").font(.title2).foregroundStyle(Theme.ink2) }
        }
        .padding(.vertical, Metrics.space1)
        .contentShape(Rectangle())
    }
}

/// What the app shows with no connection, when the profile has downloads to watch.
struct OfflineDownloadsView: View {
    var body: some View {
        NavigationStack {
            DownloadsView()
                .safeAreaInset(edge: .top) {
                    Label(String(localized: "You're offline. Your downloads still play.", bundle: .module), systemImage: "wifi.slash")
                        .font(.stFootnote).foregroundStyle(Theme.ink2)
                        .padding(.vertical, Metrics.space2)
                }
        }
    }
}

/// A circular progress indicator for a download.
struct ProgressRing: View {
    let fraction: Double

    var body: some View {
        ZStack {
            Circle().stroke(Theme.ink3.opacity(0.35), lineWidth: 2.5)
            Circle().trim(from: 0, to: max(0.02, fraction)).stroke(Theme.ink, style: StrokeStyle(lineWidth: 2.5, lineCap: .round)).rotationEffect(.degrees(-90))
        }
    }
}
#endif
