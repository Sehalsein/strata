import SwiftUI
import AVFoundation
import StrataKit
import StrataDesign
import StrataPlayerUI

/// Full-screen player: video, subtitles, glass chrome that hides after 3s,
/// the server's "getting it ready" state, errors, and Up Next for episodes.
struct WatchView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let request: WatchRequest

    @State private var chromeVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var showDetails = false
    @State private var upNextDismissed = false
    @State private var pip = PiPController()
    #if os(tvOS)
    @FocusState private var surfaceFocused: Bool
    #endif

    private var engine: PlayerEngine { services.engine }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerSurface(player: engine.player, gravity: engine.videoGravity, pip: pip)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            #if !os(tvOS)
            // The video's UIView swallows touches, so taps land on this layer instead.
            Color.clear
                .contentShape(Rectangle())
                .ignoresSafeArea()
                .gesture(
                    TapGesture(count: 2).onEnded { engine.toggleVideoGravity() }
                        .exclusively(before: TapGesture().onEnded { toggleChrome() })
                )
                // Pinch out to fill the screen, in to see the whole picture (as in Apple's player).
                .simultaneousGesture(
                    MagnifyGesture().onEnded { value in
                        if value.magnification > 1.1 { engine.videoGravity = .resizeAspectFill }
                        else if value.magnification < 0.9 { engine.videoGravity = .resizeAspect }
                    }
                )
            #else
            // Remote presses go to the focused view; with the controls hidden this
            // full-screen surface holds focus so select / play-pause / swipes still land.
            // Removed while the controls show, so focus moves to their default (play/pause).
            if !chromeVisible {
                Color.clear
                    .ignoresSafeArea()
                    .focusable()
                    .focused($surfaceFocused)
                    .onTapGesture { showChrome() }
                    .onAppear { surfaceFocused = true }
            }
            #endif

            SubtitleOverlay(engine: engine, raised: chromeVisible)

            stateOverlay

            // The error and preparing cards have their own buttons; the transport over them would clash.
            if chromeVisible, !showsStateCard {
                PlayerChrome(engine: engine, onClose: close, onDetails: { showDetails = true },
                             onPiP: pip.isAvailable ? { pip.toggle() } : nil,
                             onInteraction: { scheduleHide(after: 8) })
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
        .onMoveCommand { _ in if !chromeVisible { showChrome() } }
        #endif
        .sheet(isPresented: $showDetails) {
            StreamDetailsPanel(session: engine.session).presentationDetents([.medium])
        }
        #if os(iOS)
        .onAppear { PlayerOrientation.enterPlayer() }
        #endif
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
            #if os(iOS)
            PlayerOrientation.leavePlayer()
            #endif
            hideTask?.cancel()
            Task {
                await engine.unload()
                await services.progressChanged()
            }
        }
    }

    /// Show Up Next in the last 30s of an episode with an available next one.
    private var showUpNext: Bool {
        guard !upNextDismissed, engine.nextEpisode?.available == true, engine.duration > 60 else { return false }
        return engine.duration - engine.position <= 30 && engine.status == .playing
    }

    private var showsStateCard: Bool {
        switch engine.status {
        case .failed, .preparing: true
        default: false
        }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch engine.status {
        case .loading:
            // With the controls up, their play button shows the spinner instead (iOS).
            #if os(tvOS)
            ProgressView().controlSize(.large).tint(.white)
            #else
            if !chromeVisible { ProgressView().controlSize(.large).tint(.white) }
            #endif
        case .preparing(let status):
            VStack(spacing: Metrics.space4) {
                Image(systemName: "arrow.down.circle").font(.system(size: 44)).foregroundStyle(Theme.warning)
                Text(status.title ?? "Getting it ready").font(.stTitle2).foregroundStyle(Theme.onArtwork)
                ProgressBar(status.progress, track: .white.opacity(0.2)).frame(width: 280)
                Text([status.percentText, status.etaText].compactMap { $0 }.joined(separator: " · "))
                    .font(.stFootnote).foregroundStyle(Theme.onArtwork.opacity(0.7))
                Text(status.message ?? "It will start playing as soon as it's ready.")
                    .font(.stCallout).foregroundStyle(Theme.onArtwork.opacity(0.7)).multilineTextAlignment(.center).frame(maxWidth: 420)
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

    private func scheduleHide(after seconds: Double = 3.5) {
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, engine.status == .playing, !showDetails else { return }
            chromeVisible = false
        }
    }
}

/// The video layer, with Picture in Picture attached once it's on screen.
private struct PlayerSurface: View {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity
    let pip: PiPController

    var body: some View {
        #if os(iOS)
        AVPlayerContainer(player: player, gravity: gravity) { layer in pip.attach(playerLayer: layer) }
        #else
        AVPlayerContainer(player: player, gravity: gravity)
        #endif
    }
}
