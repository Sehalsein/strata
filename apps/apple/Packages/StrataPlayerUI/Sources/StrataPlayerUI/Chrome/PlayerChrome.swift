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
    /// Opens the list of copies to play from instead; `nil` for a download.
    let onSources: (() -> Void)?
    let onInteraction: () -> Void
    let onScrubbing: (Bool) -> Void

    /// `onInteraction` fires on any touch inside the controls, so the caller can keep
    /// them visible while someone is using them (e.g. a track menu is open).
    public init(engine: PlayerEngine, onClose: @escaping () -> Void, onDetails: @escaping () -> Void, onPiP: (() -> Void)? = nil, onSources: (() -> Void)? = nil, onInteraction: @escaping () -> Void = {}, onScrubbing: @escaping (Bool) -> Void = { _ in }) {
        self.engine = engine
        self.onClose = onClose
        self.onDetails = onDetails
        self.onPiP = onPiP
        self.onSources = onSources
        self.onInteraction = onInteraction
        self.onScrubbing = onScrubbing
    }

    private var isPlaying: Bool { engine.status == .playing }
    #if os(tvOS)
    @Namespace private var focusScope
    #endif

    public var body: some View {
        #if os(tvOS)
        tvBody
        #else
        touchBody
        #endif
    }

    #if os(tvOS)
    /// Like the TV app's player: what's playing at the bottom left over the scrubber, the
    /// track buttons above its right end, and the elapsed time with a play / pause glyph
    /// under it. Select on the scrubber plays or pauses; left and right scrub.
    private var tvBody: some View {
        ZStack(alignment: .bottom) {
            LinearGradient(stops: [
                .init(color: .clear, location: 0.4),
                .init(color: .black.opacity(0.45), location: 0.7),
                .init(color: .black.opacity(0.8), location: 1),
            ], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(alignment: .leading, spacing: Metrics.space4) {
                HStack(alignment: .bottom, spacing: Metrics.space8) {
                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        if let subtitle = engine.meta?.subtitle {
                            Text(subtitle).font(.system(size: 26, weight: .semibold)).opacity(0.85).lineLimit(1)
                        }
                        Text(engine.meta?.title ?? "")
                            .font(.system(size: 50, weight: .bold))
                            .titleTracking()
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        if let chapter = engine.currentChapter?.title {
                            Text(chapter).eyebrowStyle(Theme.onArtwork.opacity(0.75))
                        }
                    }
                    Spacer(minLength: 0)
                    GlassEffectContainer(spacing: Metrics.space2) {
                        HStack(spacing: Metrics.space4) {
                            SubtitleMenu(engine: engine)
                            AudioMenu(engine: engine)
                            SpeedMenu(engine: engine)
                        }
                    }
                }
                Scrubber(position: engine.position, duration: engine.duration, chapters: engine.chapters,
                         isPlaying: isPlaying, onSelect: { engine.togglePlay() }, onScrubbing: onScrubbing) { target in
                    Task { await engine.seek(to: target) }
                }
                .prefersDefaultFocus(true, in: focusScope)
                HStack(spacing: Metrics.space4) {
                    Button(action: onDetails) {
                        Text("Info").font(.system(size: 26, weight: .semibold)).padding(.horizontal, Metrics.space1)
                    }
                    .buttonStyle(.strataGlass)
                    .controlSize(.small)
                    if let onSources {
                        Button(action: onSources) {
                            Text("Change Source").font(.system(size: 26, weight: .semibold)).padding(.horizontal, Metrics.space1)
                        }
                        .buttonStyle(.strataGlass)
                        .controlSize(.small)
                    }
                }
                .padding(.top, Metrics.space1)
            }
            // Like the TV app's player: nearly edge to edge, not inside the safe area too.
            .padding(.horizontal, Metrics.gutter)
            .padding(.bottom, Metrics.space10)
            .ignoresSafeArea(edges: [.horizontal, .bottom])
        }
        .foregroundStyle(Theme.onArtwork)
        .focusScope(focusScope)
    }
    #endif

    private var touchBody: some View {
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
                    if let onSources { PlayerIconButton("Change Source", systemImage: "rectangle.stack", action: onSources) }
                    PlayerIconButton("Stream Details", systemImage: "info", action: onDetails)
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
            Scrubber(position: engine.position, duration: engine.duration, chapters: engine.chapters, onScrubbing: onScrubbing) { target in
                Task { await engine.seek(to: target) }
            }
            HStack(spacing: Metrics.space2) {
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
