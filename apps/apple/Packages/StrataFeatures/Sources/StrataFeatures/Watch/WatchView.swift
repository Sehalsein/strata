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
    /// "Choose Source" after a source failed to play.
    @State private var showSources = false
    @State private var upNextDismissed = false
    /// Seconds the current load has taken, for saying what's happening when it's slow.
    @State private var loadingSeconds = 0
    @State private var pip = PiPController()
    /// With VoiceOver or Switch Control the controls stay up: hidden, there'd be nothing
    /// to move to but the video.
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.accessibilitySwitchControlEnabled) private var switchControl
    #if os(tvOS)
    @FocusState private var surfaceFocused: Bool
    #endif

    private var engine: PlayerEngine { services.engine }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerSurface(engine: engine, pip: pip)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            // The title's artwork while it starts, rather than a black screen.
            if isStarting {
                // Blurred, so a small image does (as the hero's blurred posters).
                RemoteImage(url: (engine.meta ?? request.meta).artworkURL, maxPixel: 320, blur: 12, priority: .userInitiated) { Color.black }
                    .overlay(Color.black.opacity(0.55))
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }

            #if !os(tvOS)
            // The video's UIView swallows touches, so taps land on this layer instead.
            Color.clear
                .contentShape(Rectangle())
                .ignoresSafeArea()
                .gesture(
                    TapGesture(count: 2).onEnded { engine.toggleVideoGravity() }
                        .exclusively(before: TapGesture().onEnded { toggleChrome() })
                )
                // The one thing left on screen when the controls hide: say what it does.
                .accessibilityElement()
                .accessibilityLabel(chromeVisible ? "Hide controls" : "Show controls")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { toggleChrome() }
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

            #if os(iOS)
            // Space, arrows, J/L, M and C with a hardware keyboard (iPad).
            PlayerKeyCommands(engine: engine, onToggleCaptions: toggleCaptions,
                              onToggleFullscreen: { engine.toggleVideoGravity() },
                              onTogglePiP: { if pip.isAvailable { pip.toggle() } })
            #endif

            SubtitleOverlay(engine: engine, raised: chromeVisible)

            stateOverlay

            // The error and preparing cards have their own buttons; the transport over them would clash.
            if chromeVisible, !showsStateCard {
                PlayerChrome(engine: engine, onClose: close, onDetails: { showDetails = true },
                             onPiP: pip.isAvailable ? { pip.toggle() } : nil,
                             // Another copy, also while this one is still trying to start.
                             onSources: request.downloadID == nil ? { showSources = true } : nil,
                             onInteraction: { scheduleHide(after: 8) },
                             // Held up while scrubbing: hiding would drop the scrub.
                             onScrubbing: { scrubbing in if scrubbing { hideTask?.cancel() } else { scheduleHide(after: 8) } })
                    .transition(.opacity)
            }

            // Reads the position itself, so the ticks re-render it and not the whole player.
            UpNextOverlay(engine: engine, dismissed: $upNextDismissed, raised: chromeVisible, onPlay: playNext)
        }
        .animation(.easeOut(duration: 0.25), value: chromeVisible)
        .animation(.easeOut(duration: 0.35), value: isStarting)
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
        .onMoveCommand(perform: move)
        #endif
        // Turned on mid-film: bring the controls back for good.
        .onChange(of: voiceOver || switchControl) { _, on in if on { showChrome(autoHide: false) } }
        .pickerSheet(isPresented: $showSources) {
            let target = engine.target ?? request.target
            let meta = engine.meta ?? request.meta
            // Carries on from where it got to, not from where it started.
            let at = engine.position > 0 ? Int(engine.position * 1000) : request.startMs
            SourcePickerSheet(target: target, title: meta.title, current: engine.session?.candidate.id) { candidate in
                Task { await engine.load(target: target, meta: meta, candidateId: candidate.id, startMs: at) }
            }
        }
        .sheet(isPresented: $showDetails) {
            StreamDetailsPanel(session: engine.session, bytesRead: engine.remuxStats?.bytesFetched).presentationDetents([.medium])
        }
        #if os(iOS)
        .onAppear { PlayerOrientation.enterPlayer() }
        #endif
        .task {
            if let client = services.client { engine.configure(client: client) }
            await start()
            scheduleHide()
        }
        // Counted afresh at each step, and when the player moves on to another copy.
        .task(id: "\(engine.status == .loading)|\(String(describing: engine.loadingStep))|\(engine.fallbackNote ?? "")") {
            loadingSeconds = 0
            while engine.status == .loading, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                loadingSeconds += 1
            }
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
            let played = engine.target
            Task {
                await engine.unload()
                await services.titles.progressSaved(played)
            }
        }
    }

    // The "getting it ready" and "can't play" cards: roomier on the TV, where the text is
    // read from across the room and the buttons need space for the focus lift.
    #if os(tvOS)
    private static let cardTextWidth: CGFloat = 640
    private static let cardPadding: CGFloat = Metrics.space10
    private static let cardSpacing: CGFloat = Metrics.space4
    private static let buttonGap: CGFloat = Metrics.space5
    private static let cardTitleFont = Font.system(size: 40, weight: .semibold)
    private static let cardTextFont = Font.system(size: 26)
    private static let cardIconSize: CGFloat = 34
    private static let cardButtonSize: ControlSize = .small
    #else
    private static let cardTextWidth: CGFloat = 420
    private static let cardPadding: CGFloat = Metrics.space8
    private static let cardSpacing: CGFloat = Metrics.space4
    private static let buttonGap: CGFloat = Metrics.space2
    private static let cardTitleFont = Font.stTitle2
    private static let cardTextFont = Font.stCallout
    private static let cardIconSize: CGFloat = 40
    private static let cardButtonSize: ControlSize = .large
    #endif

    /// Nothing to show yet: asking the server, or the first frames on their way.
    private var isStarting: Bool {
        switch engine.status {
        case .idle, .loading, .preparing: true
        default: false
        }
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
            VStack(spacing: Metrics.space4) {
                // With the controls up, their play button shows the spinner instead (iOS).
                #if os(tvOS)
                ProgressView().controlSize(.large).tint(.white)
                #else
                if !chromeVisible { ProgressView().controlSize(.large).tint(.white) }
                #endif
                if !chromeVisible {
                    Text((engine.meta ?? request.meta).title)
                        .font(.stTitle2)
                        .foregroundStyle(Theme.onArtwork)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .frame(maxWidth: 520)
                }
                if let loadingCaption {
                    Text(loadingCaption)
                        .font(.stCallout)
                        .foregroundStyle(Theme.onArtwork.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: engine.fallbackNote == nil ? 420 : 640)
                        #if !os(tvOS)
                        // Under the centre controls while they're up, not behind them.
                        .padding(.top, chromeVisible ? 160 : 0)
                        #endif
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.25), value: loadingCaption)
        case .preparing(let status):
            VStack(spacing: Self.cardSpacing) {
                Image(systemName: "arrow.down.circle").font(.system(size: Self.cardIconSize + 4)).foregroundStyle(Theme.warning)
                Text(status.title ?? "Getting it ready").font(Self.cardTitleFont).foregroundStyle(Theme.onArtwork)
                ProgressBar(status.progress, track: .white.opacity(0.2)).frame(width: 280)
                Text([status.percentText, status.etaText].compactMap { $0 }.joined(separator: " · "))
                    .font(.stFootnote).foregroundStyle(Theme.onArtwork.opacity(0.7))
                Text(status.message ?? "It will start playing as soon as it's ready.")
                    .font(Self.cardTextFont).foregroundStyle(Theme.onArtwork.opacity(0.7)).multilineTextAlignment(.center).frame(maxWidth: Self.cardTextWidth)
                // Why it's getting this copy ready: the first one wouldn't play.
                if let note = engine.fallbackNote {
                    Text(note).font(.stFootnote).foregroundStyle(Theme.warning).multilineTextAlignment(.center).frame(maxWidth: Self.cardTextWidth)
                }
                GlassButton("Close", size: Self.cardButtonSize, action: close)
            }
            .padding(Self.cardPadding)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
        case .failed(let message):
            VStack(spacing: Self.cardSpacing) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: Self.cardIconSize)).foregroundStyle(Theme.danger)
                Text("Can't play this").font(Self.cardTitleFont).foregroundStyle(Theme.onArtwork)
                Text(message).font(Self.cardTextFont).foregroundStyle(Theme.onArtwork.opacity(0.75)).multilineTextAlignment(.center).frame(maxWidth: Self.cardTextWidth)
                GlassEffectContainer(spacing: Metrics.space2) {
                    HStack(spacing: Self.buttonGap) {
                        PlayButton("Try Again", systemImage: "arrow.clockwise", size: Self.cardButtonSize) {
                            Task { await start() }
                        }
                        // The message often says to pick another source: offer the list here.
                        if request.downloadID == nil {
                            GlassButton("Choose Source", systemImage: "rectangle.stack", size: Self.cardButtonSize) { showSources = true }
                        }
                        GlassButton("Close", size: Self.cardButtonSize, action: close)
                    }
                }
                .padding(.top, Self.cardSpacing)
            }
            .padding(Self.cardPadding)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
        default:
            EmptyView()
        }
    }

    /// What a start is doing, as the engine reports each step it goes through (asking the
    /// server, reading the file, connecting, the server's stream, buffering); after a while
    /// on one step, that it's still at it and why. Nothing for the first second, since most
    /// starts are quicker than that. Switching to another copy is said straight away, with why.
    private var loadingCaption: String? {
        if let note = engine.fallbackNote {
            guard loadingSeconds >= 8, let step = engine.loadingStep else { return note }
            return note + " " + step.label
        }
        guard loadingSeconds >= 1, let step = engine.loadingStep else { return nil }
        return loadingSeconds >= 10 ? step.slowLabel : step.label
    }

    /// Streams the title, or plays its download from the device.
    private func start() async {
        #if os(iOS)
        if let id = request.downloadID {
            let downloads = DownloadStore.shared
            guard let item = downloads.item(id: id), let file = downloads.fileURL(for: item) else { close(); return }
            await engine.load(offline: item.playResponse(fileURL: file, resumeMs: request.startMs ?? item.positionMs),
                              target: request.target, meta: request.meta)
            return
        }
        #endif
        await engine.load(target: request.target, meta: request.meta, candidateId: request.candidateId, startMs: request.startMs)
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

    /// C: off, or on with the first track that can show.
    private func toggleCaptions() {
        let track = engine.captionsEnabled ? nil : engine.subtitleTracks.first(where: \.isShowable)
        Task { await engine.selectSubtitle(track) }
    }

    #if os(tvOS)
    /// Like the TV app's player: with the controls hidden, left and right skip back and
    /// on 10 seconds (and show where that landed), down opens the info panel, up shows
    /// the controls. With them up, moving around them keeps them up a while longer.
    private func move(_ direction: MoveCommandDirection) {
        if chromeVisible { scheduleHide(after: 8); return }
        // The error and preparing cards' buttons take left and right for themselves.
        guard !showsStateCard else { return }
        switch direction {
        case .left, .right:
            if engine.duration > 0 { Task { await engine.skip(direction == .left ? -10 : 10) } }
            showChrome()
        case .down: showDetails = true
        default: showChrome()
        }
    }
    #endif

    private func toggleChrome() {
        if chromeVisible { chromeVisible = false } else { showChrome() }
    }

    private func showChrome(autoHide: Bool = true) {
        chromeVisible = true
        if autoHide { scheduleHide() } else { hideTask?.cancel() }
    }

    private func scheduleHide(after seconds: Double = 3.5) {
        hideTask?.cancel()
        guard !voiceOver, !switchControl else { return }
        hideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, engine.status == .playing, !showDetails else { return }
            chromeVisible = false
        }
    }
}

/// Up Next in the last 30s of an episode with an available next one. Its own view
/// because it reads the playhead, which moves several times a second.
private struct UpNextOverlay: View {
    let engine: PlayerEngine
    @Binding var dismissed: Bool
    /// Above the controls while they show.
    let raised: Bool
    let onPlay: () -> Void

    private var shows: Bool {
        guard !dismissed, engine.nextEpisode?.available == true, engine.duration > 60 else { return false }
        return engine.duration - engine.position <= 30 && engine.status == .playing
    }

    var body: some View {
        ZStack {
            if let next = engine.nextEpisode, shows {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        UpNextCard(next: next, countdown: max(0, Int(engine.duration - engine.position)), onPlay: onPlay) {
                            dismissed = true
                        }
                    }
                }
                .padding(Metrics.gutter)
                .padding(.bottom, raised ? 140 : 0)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: shows)
    }
}

/// The video layer, with Picture in Picture attached once it's on screen.
/// On Apple TV it also asks the TV to match the video's frame rate and dynamic range.
private struct PlayerSurface: View {
    let engine: PlayerEngine
    let pip: PiPController

    var body: some View {
        #if os(iOS)
        AVPlayerContainer(player: engine.player, gravity: engine.videoGravity) { layer in pip.attach(playerLayer: layer) }
        #elseif os(tvOS)
        AVPlayerContainer(player: engine.player, gravity: engine.videoGravity).matchingDisplay(engine.displayCriteria)
        #else
        AVPlayerContainer(player: engine.player, gravity: engine.videoGravity)
        #endif
    }
}
