import SwiftUI
import AVFoundation
import StrataKit
import StrataDesign
import StrataPlayerUI

/// Full-screen player: video, subtitles, glass chrome that hides after 3s,
/// the TorBox "downloading" state, and Up Next for episodes.
struct WatchView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let request: WatchRequest

    @State private var chromeVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var showDetails = false
    @State private var upNextDismissed = false
    @State private var pip = PiPController()

    private var engine: PlayerEngine { services.engine }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerSurface(player: engine.player, gravity: engine.videoGravity, pip: pip)
                .ignoresSafeArea()
                #if !os(tvOS)
                .onTapGesture { toggleChrome() }
                .onTapGesture(count: 2) { engine.toggleVideoGravity() }
                #endif

            SubtitleOverlay(engine: engine, raised: chromeVisible)

            stateOverlay

            if chromeVisible {
                PlayerChrome(engine: engine, onClose: close, onDetails: { showDetails = true }, onPiP: pip.isAvailable ? { pip.toggle() } : nil)
                    .transition(.opacity)
            }

            if let next = engine.nextEpisode, showUpNext {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        UpNextCard(next: next, countdown: max(0, Int(engine.duration - engine.position)), onPlay: playNext) {
                            upNextDismissed = true
                        }
                    }
                }
                .padding(Metrics.gutter)
                .padding(.bottom, chromeVisible ? 140 : 0)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.25), value: chromeVisible)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showUpNext)
        .preferredColorScheme(.dark)
        #if os(iOS)
        .statusBarHidden(!chromeVisible)
        .persistentSystemOverlays(.hidden)
        #endif
        #if os(tvOS)
        .onPlayPauseCommand { engine.togglePlay(); showChrome() }
        .onExitCommand {
            if chromeVisible { chromeVisible = false } else { close() }
        }
        .onMoveCommand { _ in showChrome() }
        #endif
        .sheet(isPresented: $showDetails) {
            StreamDetailsPanel(session: engine.session).presentationDetents([.medium])
        }
        .task {
            if let client = services.client { engine.configure(client: client) }
            await engine.load(target: request.target, meta: request.meta, candidateId: request.candidateId, startMs: request.startMs)
            scheduleHide()
        }
        .onChange(of: engine.status) { _, status in
            if status == .ended {
                if engine.nextEpisode?.available == true, !upNextDismissed { playNext() } else { close() }
            }
            if status == .paused { showChrome(autoHide: false) } else if status == .playing { scheduleHide() }
        }
        .onDisappear {
            hideTask?.cancel()
            Task { await engine.unload() }
        }
    }

    /// Show Up Next in the last 30s of an episode with an available next one.
    private var showUpNext: Bool {
        guard !upNextDismissed, engine.nextEpisode?.available == true, engine.duration > 60 else { return false }
        return engine.duration - engine.position <= 30 && engine.status == .playing
    }

    @ViewBuilder private var stateOverlay: some View {
        switch engine.status {
        case .loading:
            ProgressView().controlSize(.large).tint(.white)
        case .preparing(let download):
            VStack(spacing: Metrics.space4) {
                Image(systemName: "arrow.down.circle").font(.system(size: 44)).foregroundStyle(Theme.warning)
                Text("Downloading on TorBox").font(.stTitle2).foregroundStyle(Theme.onArtwork)
                ProgressBar(download.progress, track: .white.opacity(0.2)).frame(width: 280)
                Text([download.percentText, download.etaText].compactMap { $0 }.joined(separator: " · "))
                    .font(.stFootnote).foregroundStyle(Theme.onArtwork.opacity(0.7))
                Text("It will start playing as soon as it's ready.").font(.stCallout).foregroundStyle(Theme.onArtwork.opacity(0.7))
                GlassButton("Close", action: close)
            }
            .padding(Metrics.space8)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
        case .failed(let message):
            VStack(spacing: Metrics.space4) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(Theme.danger)
                Text("Can't play this").font(.stTitle2).foregroundStyle(Theme.onArtwork)
                Text(message).font(.stCallout).foregroundStyle(Theme.onArtwork.opacity(0.75)).multilineTextAlignment(.center).frame(maxWidth: 420)
                GlassEffectContainer(spacing: Metrics.space2) {
                    HStack(spacing: Metrics.space2) {
                        PlayButton("Try Again", systemImage: "arrow.clockwise") {
                            Task { await engine.load(target: request.target, meta: request.meta, candidateId: request.candidateId, startMs: request.startMs) }
                        }
                        GlassButton("Close", action: close)
                    }
                }
            }
            .padding(Metrics.space8)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
        default:
            EmptyView()
        }
    }

    private func playNext() {
        upNextDismissed = false
        guard let next = engine.nextEpisode else { return }
        let meta = PlaybackMeta(title: request.meta.title, subtitle: "S\(next.season) · E\(next.episode) · \(next.name)", artworkURL: next.stillUrl ?? request.meta.artworkURL)
        Task { await engine.playNext(meta: meta) }
    }

    private func close() {
        hideTask?.cancel()
        services.watching = nil
        dismiss()
    }

    private func toggleChrome() {
        if chromeVisible { chromeVisible = false } else { showChrome() }
    }

    private func showChrome(autoHide: Bool = true) {
        chromeVisible = true
        if autoHide { scheduleHide() } else { hideTask?.cancel() }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3.5))
            guard !Task.isCancelled, engine.status == .playing, !showDetails else { return }
            chromeVisible = false
        }
    }
}

/// The video layer, with Picture in Picture attached once it's laid out.
private struct PlayerSurface: View {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity
    let pip: PiPController

    var body: some View {
        AVPlayerContainer(player: player, gravity: gravity)
            #if os(iOS)
            .background(PiPAttachment(pip: pip).frame(width: 0, height: 0))
            #endif
    }
}

#if os(iOS)
private struct PiPAttachment: UIViewRepresentable {
    let pip: PiPController

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        DispatchQueue.main.async {
            var root: UIView? = view
            while let parent = root?.superview { root = parent }
            if let host = root.flatMap(Self.findHost) { pip.attach(playerLayer: host.playerLayer) }
        }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    private static func findHost(in view: UIView) -> PlayerLayerHostView? {
        if let host = view as? PlayerLayerHostView { return host }
        for sub in view.subviews { if let found = findHost(in: sub) { return found } }
        return nil
    }
}
#endif
