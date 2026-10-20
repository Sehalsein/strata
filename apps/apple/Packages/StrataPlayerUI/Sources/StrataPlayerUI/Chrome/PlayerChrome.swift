import SwiftUI
import AVFoundation
import StrataDesign
import StrataKit

/// The overlay on top of playing video: title, glass transport controls,
/// scrubber and track menus. The caller decides when it's visible.
public struct PlayerChrome: View {
    @Bindable var engine: PlayerEngine
    let onClose: () -> Void
    let onDetails: () -> Void
    let onPiP: (() -> Void)?
    let onInteraction: () -> Void

    /// `onInteraction` fires on any touch inside the controls, so the caller can keep
    /// them visible while someone is using them (e.g. a track menu is open).
    public init(engine: PlayerEngine, onClose: @escaping () -> Void, onDetails: @escaping () -> Void, onPiP: (() -> Void)? = nil, onInteraction: @escaping () -> Void = {}) {
        self.engine = engine
        self.onClose = onClose
        self.onDetails = onDetails
        self.onPiP = onPiP
        self.onInteraction = onInteraction
    }

    private var isPlaying: Bool { engine.status == .playing }
    #if os(tvOS)
    @Namespace private var focusScope
    #endif

    public var body: some View {
        ZStack {
            LinearGradient(stops: [
                .init(color: .black.opacity(0.55), location: 0),
                .init(color: .clear, location: 0.25),
                .init(color: .clear, location: 0.6),
                .init(color: .black.opacity(0.7), location: 1),
            ], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 0) {
                topBar
                Spacer()
                #if !os(tvOS)
                centerControls
                Spacer()
                #endif
                bottomBar
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, Metrics.space4)
            .simultaneousGesture(TapGesture().onEnded { onInteraction() })
        }
        .foregroundStyle(Theme.onArtwork)
        #if os(tvOS)
        .focusScope(focusScope)
        #endif
    }

    private var topBar: some View {
        HStack(alignment: .center, spacing: Metrics.space3) {
            #if !os(tvOS)
            PlayerIconButton("Close", systemImage: "xmark", action: onClose)
            #endif
            VStack(alignment: .leading, spacing: 2) {
                Text(engine.meta?.title ?? "").font(.stHeadline).lineLimit(1)
                if let subtitle = engine.meta?.subtitle {
                    Text(subtitle).font(.stFootnote).opacity(0.75).lineLimit(1)
                }
            }
            Spacer(minLength: Metrics.space2)
            GlassEffectContainer(spacing: Metrics.space2) {
                HStack(spacing: Metrics.space2) {
                    #if !os(tvOS)
                    // Fit shows the whole picture; fill crops to the screen (also pinch or double-tap).
                    PlayerIconButton(isFilled ? "Fit to Screen" : "Fill Screen",
                                     systemImage: isFilled ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") {
                        engine.toggleVideoGravity()
                    }
                    if let onPiP { PlayerIconButton("Picture in Picture", systemImage: "pip.enter", action: onPiP) }
                    AirPlayRoutePicker()
                        .frame(width: 30, height: 30)
                        .padding(7)
                        .glassEffect(.regular.interactive(), in: .circle)
                    #endif
                    PlayerIconButton("Stream details", systemImage: "info", action: onDetails)
                }
            }
        }
    }

    #if !os(tvOS)
    private var centerControls: some View {
        GlassEffectContainer(spacing: Metrics.space6) {
            HStack(spacing: Metrics.space6) {
                PlayerIconButton("Back 10 seconds", systemImage: "gobackward.10") { Task { await engine.skip(-10) } }
                if isWaiting {
                    // One spinner, in the play button's place, while loading or buffering.
                    ProgressView()
                        .controlSize(.large)
                        .tint(.white)
                        .frame(width: 76, height: 76)
                        .glassEffect(.regular, in: .circle)
                        .accessibilityLabel("Loading")
                } else {
                    PlayerIconButton(isPlaying ? "Pause" : "Play", systemImage: isPlaying ? "pause.fill" : "play.fill", size: .large) { engine.togglePlay() }
                }
                PlayerIconButton("Forward 10 seconds", systemImage: "goforward.10") { Task { await engine.skip(10) } }
            }
        }
    }

    private var isFilled: Bool { engine.videoGravity == .resizeAspectFill }

    private var isWaiting: Bool { engine.isBuffering || engine.status == .loading }
    #endif

    private var bottomBar: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            if let chapter = engine.currentChapter?.title {
                Text(chapter).eyebrowStyle(Theme.onArtwork.opacity(0.75))
            }
            Scrubber(position: engine.position, duration: engine.duration, chapters: engine.chapters) { target in
                Task { await engine.seek(to: target) }
            }
            HStack(spacing: Metrics.space2) {
                #if os(tvOS)
                GlassEffectContainer(spacing: Metrics.space2) {
                    HStack(spacing: Metrics.space2) {
                        PlayerIconButton("Back 10 seconds", systemImage: "gobackward.10") { Task { await engine.skip(-10) } }
                        PlayerIconButton(isPlaying ? "Pause" : "Play", systemImage: isPlaying ? "pause.fill" : "play.fill") { engine.togglePlay() }
                            .prefersDefaultFocus(true, in: focusScope)
                        PlayerIconButton("Forward 10 seconds", systemImage: "goforward.10") { Task { await engine.skip(10) } }
                    }
                }
                #endif
                Spacer()
                GlassEffectContainer(spacing: Metrics.space2) {
                    HStack(spacing: Metrics.space2) {
                        AudioMenu(engine: engine)
                        SubtitleMenu(engine: engine)
                        SpeedMenu(engine: engine)
                    }
                }
            }
        }
    }
}
