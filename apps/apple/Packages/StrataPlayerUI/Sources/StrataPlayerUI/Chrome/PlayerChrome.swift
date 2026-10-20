import SwiftUI
import StrataDesign
import StrataKit

/// The overlay on top of playing video: title, glass transport controls,
/// scrubber and track menus. The caller decides when it's visible.
public struct PlayerChrome: View {
    @Bindable var engine: PlayerEngine
    let onClose: () -> Void
    let onDetails: () -> Void
    let onPiP: (() -> Void)?

    public init(engine: PlayerEngine, onClose: @escaping () -> Void, onDetails: @escaping () -> Void, onPiP: (() -> Void)? = nil) {
        self.engine = engine
        self.onClose = onClose
        self.onDetails = onDetails
        self.onPiP = onPiP
    }

    private var isPlaying: Bool { engine.status == .playing }

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
                PlayerIconButton(isPlaying ? "Pause" : "Play", systemImage: isPlaying ? "pause.fill" : "play.fill", size: .large) { engine.togglePlay() }
                PlayerIconButton("Forward 10 seconds", systemImage: "goforward.10") { Task { await engine.skip(10) } }
            }
        }
        .opacity(engine.isBuffering ? 0.6 : 1)
        .overlay { if engine.isBuffering { ProgressView().controlSize(.large).tint(.white) } }
    }
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
