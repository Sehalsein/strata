import SwiftUI
import StrataKit
import StrataDesign
import StrataPlayerUI
import AVFoundation

public struct WatchView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    public let request: WatchRequest

    @State private var hideChrome = false
    @State private var hideTimer: Task<Void, Never>?
    @State private var showStreamDetails = false
    @State private var pip = PiPController()
    @State private var upNext: BaseItem?
    @State private var upNextCountdown: Int = 30
    @State private var upNextTimer: Task<Void, Never>?
    @State private var trickplayProvider: TrickplayProvider?
    @State private var pinchPreviewScale: CGFloat = 1.0
    @State private var pinchBaselineGravity: AVLayerVideoGravity = .resizeAspect
    @State private var showGravityIndicator = false
    @State private var gravityIndicatorTask: Task<Void, Never>?
    #if os(tvOS)
    @FocusState private var chromeFocused: Bool
    #endif

    public init(request: WatchRequest) {
        self.request = request
    }

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerHost(
                player: services.engine.player,
                gravity: services.engine.videoGravity,
                pip: pip
            )
            .ignoresSafeArea()
            #if !os(tvOS)
            .gesture(
                MagnificationGesture()
                    .onChanged { value in
                        if pinchPreviewScale == 1.0 {
                            pinchBaselineGravity = services.engine.videoGravity
                        }
                        pinchPreviewScale = value
                        let target: AVLayerVideoGravity
                        if value > 1.15 {
                            target = .resizeAspectFill
                        } else if value < 0.9 {
                            target = .resizeAspect
                        } else {
                            target = pinchBaselineGravity
                        }
                        if services.engine.videoGravity != target {
                            services.engine.setVideoGravity(target)
                            flashGravityIndicator()
                        }
                    }
                    .onEnded { _ in
                        pinchPreviewScale = 1.0
                    }
            )
            .onTapGesture(count: 2) {
                services.engine.toggleVideoGravity()
                flashGravityIndicator()
            }
            #endif
            // Using AVPlayerViewController / AVPlayerView for video display;
            // they provide their own transport controls, subtitle picker,
            // AirPlay/PiP buttons, and aspect controls. Custom TransportBar
            // and SubtitleOverlay are intentionally not rendered to avoid
            // competing with the system UI.

            if showStreamDetails {
                VStack {
                    HStack {
                        Spacer()
                        StreamDetailsPanel(plan: services.engine.plan, item: services.engine.item)
                            .padding(20)
                    }
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            if let next = upNext {
                VStack {
                    Spacer()
                    UpNextCard(
                        next: next,
                        images: services.images,
                        countdown: upNextCountdown,
                        onPlay: { Task { await playNext(next) } },
                        onDismiss: { cancelUpNext() }
                    )
                    .padding(.bottom, 120)
                    .padding(.horizontal, 20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }

            // Floating "Skip Intro / Skip Credits" button — appears only while
            // the playhead sits inside an intro/credits segment.
            if let skip = services.engine.activeSkip {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        SkipSegmentButton(title: skip.title) {
                            Task { await services.engine.skipActiveSegment() }
                        }
                    }
                }
                .padding(.trailing, 28)
                .padding(.bottom, 150)
                .transition(.opacity)
            }

            // Sleep timer — surfaced with the rest of the chrome so it doesn't
            // clutter the frame during playback. tvOS drives chrome through the
            // focus engine, so the menu is phone/desktop only.
            #if !os(tvOS)
            if !hideChrome {
                VStack {
                    HStack {
                        Spacer()
                        SleepTimerMenu(
                            current: services.engine.sleepTimerEnds,
                            onSelect: { services.engine.setSleepTimer($0) }
                        )
                    }
                    Spacer()
                }
                .padding(.trailing, 24)
                .padding(.top, 60)
                .transition(.opacity)
            }
            #endif

            if case .loading = services.engine.status {
                ProgressView().tint(Strata.Tokens.paper).scaleEffect(1.4)
            }
            if case let .failed(message) = services.engine.status {
                GlassPanel(strong: true) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("PLAYBACK FAILED").strataSpec()
                        Text(message).font(.plex(13)).foregroundStyle(Strata.Tokens.paper)
                        SecondaryButton("Close", systemImage: "xmark") { dismiss() }
                    }
                }
                .frame(maxWidth: 420)
                .padding()
            }

            PlayerKeyCommands(
                engine: services.engine,
                onToggleCaptions: { Task { await toggleCaptions() } },
                onToggleFullscreen: {},
                onTogglePiP: { pip.toggle() }
            )

            if showGravityIndicator {
                GravityIndicator(gravity: services.engine.videoGravity)
                    .transition(.opacity)
            }
        }
        .contentShape(Rectangle())
        #if os(tvOS)
        .onPlayPauseCommand {
            services.engine.togglePlay()
            wakeChrome()
        }
        .onMoveCommand { _ in wakeChrome() }
        .onExitCommand {
            if !hideChrome {
                withAnimation(.easeOut(duration: 0.25)) { hideChrome = true }
            } else {
                dismiss()
            }
        }
        .onChange(of: chromeFocused) { _, focused in
            if focused {
                hideTimer?.cancel()
            } else {
                scheduleAutoHide()
            }
        }
        #else
        .onTapGesture {
            withAnimation(.easeOut(duration: 0.25)) { hideChrome.toggle() }
            scheduleAutoHide()
        }
        #endif
        .task { await loadIfNeeded() }
        .onChange(of: services.engine.position) { _, pos in
            checkUpNext(at: pos)
            #if canImport(ActivityKit) && os(iOS)
            StrataPlayerUI.LiveActivityBridge.shared.update(
                position: pos,
                duration: services.engine.duration,
                isPaused: services.engine.status == .paused
            )
            #endif
        }
        .onDisappear {
            Task { await services.engine.unload() }
            hideTimer?.cancel()
            upNextTimer?.cancel()
            #if canImport(ActivityKit) && os(iOS)
            StrataPlayerUI.LiveActivityBridge.shared.end()
            #endif
        }
        .handoffForWatching(itemId: request.itemId, position: services.engine.position)
        #if os(iOS)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        #endif
    }

    private func loadIfNeeded() async {
        guard let client = services.client else { return }
        if let current = services.engine.item, current.id == request.itemId { return }
        services.engine.configure(client: client, nowPlaying: services.nowPlaying)
        if let item = try? await client.getItem(request.itemId) {
            await services.engine.load(item: item)
            if let start = request.startSeconds, start > 5 {
                await services.engine.seek(to: start)
            }
            scheduleAutoHide()
            await prepareNextEpisode(after: item)
            #if canImport(ActivityKit) && os(iOS)
            await MainActor.run {
                StrataPlayerUI.LiveActivityBridge.shared.start(
                    itemId: item.id,
                    title: item.displayTitle,
                    subtitle: item.seriesName,
                    artworkURL: services.images?.backdrop(itemId: item.id) ?? services.images?.primary(itemId: item.id),
                    duration: services.engine.duration
                )
            }
            #endif
        }
    }

    private func toggleCaptions() async {
        if services.engine.activeSubtitleIndex == nil {
            if let first = services.engine.subtitleTracks.first {
                await services.engine.selectSubtitle(first)
            }
        } else {
            await services.engine.selectSubtitle(nil)
        }
    }

    private func prepareNextEpisode(after item: BaseItem) async {
        guard item.type == .episode, let client = services.client else { return }
        upNext = try? await client.nextEpisode(after: item)
    }

    private func checkUpNext(at position: TimeInterval) {
        let duration = services.engine.duration
        guard duration > 0, upNext != nil, upNextTimer == nil else { return }
        let remaining = duration - position
        guard remaining < 30, remaining > 0 else { return }
        upNextCountdown = max(0, Int(remaining))
        upNextTimer = Task { @MainActor in
            while !Task.isCancelled, let _ = upNext {
                if services.engine.duration > 0 {
                    upNextCountdown = max(0, Int(services.engine.duration - services.engine.position))
                    if upNextCountdown <= 0 {
                        if let next = upNext { await playNext(next) }
                        break
                    }
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
    }

    private func cancelUpNext() {
        upNextTimer?.cancel()
        upNextTimer = nil
        upNext = nil
    }

    private func playNext(_ next: BaseItem) async {
        upNextTimer?.cancel()
        upNextTimer = nil
        upNext = nil
        await services.engine.load(item: next)
        await prepareNextEpisode(after: next)
    }

    private func scheduleAutoHide() {
        hideTimer?.cancel()
        hideTimer = Task {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if Task.isCancelled { return }
            await MainActor.run {
                #if os(tvOS)
                if chromeFocused { return }
                #endif
                withAnimation(.easeOut(duration: 0.35)) { hideChrome = true }
            }
        }
    }

    #if os(tvOS)
    private func wakeChrome() {
        if hideChrome {
            withAnimation(.easeOut(duration: 0.25)) { hideChrome = false }
        }
        scheduleAutoHide()
    }
    #endif

    private func flashGravityIndicator() {
        gravityIndicatorTask?.cancel()
        withAnimation(.easeOut(duration: 0.18)) { showGravityIndicator = true }
        gravityIndicatorTask = Task {
            try? await Task.sleep(nanoseconds: 900_000_000)
            if Task.isCancelled { return }
            await MainActor.run {
                withAnimation(.easeIn(duration: 0.25)) { showGravityIndicator = false }
            }
        }
    }
}

/// Floating editorial "Skip Intro / Skip Credits" pill, mirroring the
/// bottom-trailing placement users know from Netflix / Apple TV.
private struct SkipSegmentButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.mono(13, weight: .semibold))
                    .tracking(1.5)
                Image(systemName: "forward.end.fill")
                    .font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(Strata.Tokens.bg)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(Capsule().fill(Strata.Tokens.paper))
            .overlay(Capsule().stroke(Strata.Tokens.bg.opacity(0.15), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

#if !os(tvOS)
/// Sleep-timer menu button. Filled icon while armed.
private struct SleepTimerMenu: View {
    let current: Date?
    let onSelect: (PlayerEngine.SleepOption) -> Void

    var body: some View {
        Menu {
            ForEach(PlayerEngine.SleepOption.allCases) { option in
                Button(option.label) { onSelect(option) }
            }
        } label: {
            Image(systemName: current == nil ? "moon.zzz" : "moon.zzz.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Strata.Tokens.paper)
                .frame(width: 40, height: 40)
                .background(Circle().fill(.black.opacity(0.45)))
        }
        .accessibilityLabel("Sleep timer")
    }
}
#endif

/// Brief centered HUD that confirms the new aspect mode after a pinch or
/// double-tap — same idea as the volume / brightness indicators in Apple
/// Photos.
private struct GravityIndicator: View {
    let gravity: AVLayerVideoGravity

    private var label: String {
        gravity == .resizeAspectFill ? "Zoomed to Fill" : "Fit to Screen"
    }
    private var systemImage: String {
        gravity == .resizeAspectFill
        ? "rectangle.arrowtriangle.2.outward"
        : "rectangle.arrowtriangle.2.inward"
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
            Text(label)
                .font(.mono(11, weight: .semibold))
                .tracking(1.5)
                .textCase(.uppercase)
        }
        .foregroundStyle(Strata.Tokens.paper)
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(.black.opacity(0.65))
        .clipShape(Capsule())
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .allowsHitTesting(false)
    }
}

/// Wraps `AVPlayerContainer` so we can attach the PiP controller after the
/// layer is laid out.
private struct PlayerHost: View {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity
    let pip: PiPController
    var body: some View {
        AVPlayerContainer(player: player, gravity: gravity)
            .background(
                PiPAttachmentView(pip: pip)
                    .frame(width: 0, height: 0)
            )
    }
}

#if canImport(UIKit) && !targetEnvironment(macCatalyst)
import UIKit

private struct PiPAttachmentView: UIViewRepresentable {
    let pip: PiPController
    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        DispatchQueue.main.async {
            if let host = v.superview?.subviews.compactMap({ $0 as? PlayerLayerHostView }).first {
                pip.attach(playerLayer: host.playerLayer)
            }
        }
        return v
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
#elseif canImport(AppKit)
import AppKit

private struct PiPAttachmentView: NSViewRepresentable {
    let pip: PiPController
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async {
            if let host = v.superview?.subviews.compactMap({ $0 as? PlayerLayerHostNSView }).first {
                pip.attach(playerLayer: host.playerLayer)
            }
        }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
}
#endif
