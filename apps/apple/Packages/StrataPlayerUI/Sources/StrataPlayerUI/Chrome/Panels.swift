import SwiftUI
import StrataDesign
import StrataKit

/// The active subtitle cue, centered above the controls.
public struct SubtitleOverlay: View {
    @Bindable var engine: PlayerEngine
    let raised: Bool

    public init(engine: PlayerEngine, raised: Bool = false) {
        self.engine = engine
        self.raised = raised
    }

    #if os(tvOS)
    private let font = Font.system(size: 44, weight: .semibold)
    #else
    private let font = Font.title3.weight(.semibold)
    #endif

    public var body: some View {
        VStack {
            Spacer()
            if let text = engine.activeCueText {
                Text(text)
                    .font(font)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.9), radius: 3, y: 1)
                    .padding(.horizontal, Metrics.space4)
                    .padding(.vertical, Metrics.space2)
                    .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous))
                    .transition(.opacity)
            }
        }
        .padding(.bottom, raised ? 180 : 48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeOut(duration: 0.15), value: engine.activeCueText)
        .allowsHitTesting(false)
    }
}

/// "Up next" card that counts down to the next episode.
public struct UpNextCard: View {
    let next: NextEpisode
    let countdown: Int
    let onPlay: () -> Void
    let onDismiss: () -> Void

    public init(next: NextEpisode, countdown: Int, onPlay: @escaping () -> Void, onDismiss: @escaping () -> Void) {
        self.next = next
        self.countdown = countdown
        self.onPlay = onPlay
        self.onDismiss = onDismiss
    }

    public var body: some View {
        HStack(alignment: .center, spacing: Metrics.space4) {
            ArtworkImage(url: next.stillUrl, aspectRatio: 16 / 9, seed: next.code, cornerRadius: Metrics.radiusSM)
                .frame(width: 160)
            VStack(alignment: .leading, spacing: Metrics.space1) {
                Text("Up next in \(countdown)s").eyebrowStyle(Theme.accentText)
                Text(next.name).font(.stHeadline).foregroundStyle(Theme.onArtwork).lineLimit(2)
                Text(next.code).font(.stFootnote).foregroundStyle(Theme.onArtwork.opacity(0.7))
                GlassEffectContainer(spacing: Metrics.space2) {
                    HStack(spacing: Metrics.space2) {
                        PlayButton("Play Now", systemImage: "forward.fill", action: onPlay)
                        GlassButton("Cancel", action: onDismiss)
                    }
                }
                .padding(.top, Metrics.space2)
            }
        }
        .padding(Metrics.space4)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
        .frame(maxWidth: 520)
    }
}

/// What's playing and how: shown from the player's info button.
public struct StreamDetailsPanel: View {
    let session: PlayResponse?

    public init(session: PlayResponse?) { self.session = session }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            Text("Stream details").font(.stTitle2).foregroundStyle(Theme.ink)
            if let session {
                let c = session.candidate
                Grid(alignment: .leading, horizontalSpacing: Metrics.space4, verticalSpacing: Metrics.space2) {
                    row("Source", c.provider.label)
                    row("File", c.displayName)
                    row("Playback", session.mode.label)
                    row("Video", [c.resolutionLabel, c.codecLabel, c.hdrLabel].compactMap { $0 }.joined(separator: " · "))
                    row("Audio", session.selectedAudio?.displayTitle ?? "—")
                    if let size = c.sizeLabel { row("Size", size) }
                    if !session.reasons.isEmpty { row("Why", session.reasons.joined(separator: "; ")) }
                }
            } else {
                Text("Nothing is playing.").font(.stCallout).foregroundStyle(Theme.ink2)
            }
        }
        .padding(Metrics.space6)
        .frame(maxWidth: 480, alignment: .leading)
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).font(.stFootnote).foregroundStyle(Theme.ink3)
            Text(value.isEmpty ? "—" : value).font(.stCallout).foregroundStyle(Theme.ink)
                #if !os(tvOS)
                .textSelection(.enabled)
                #endif
        }
    }
}

/// Horizontal list of chapters; tap to jump.
public struct ChaptersRail: View {
    let chapters: [Chapter]
    let position: TimeInterval
    let onSelect: (TimeInterval) -> Void

    public init(chapters: [Chapter], position: TimeInterval, onSelect: @escaping (TimeInterval) -> Void) {
        self.chapters = chapters
        self.position = position
        self.onSelect = onSelect
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Metrics.space2) {
                ForEach(Array(chapters.enumerated()), id: \.offset) { index, chapter in
                    let current = chapters.last(where: { $0.start <= position })?.startMs == chapter.startMs
                    Button {
                        onSelect(chapter.start)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(chapter.title ?? "Chapter \(index + 1)").font(.stCallout.weight(.semibold)).lineLimit(1)
                            Text(Scrubber.format(chapter.start)).font(.stTimecode).opacity(0.7)
                        }
                        .padding(.horizontal, Metrics.space2)
                    }
                    .buttonStyle(.glass)
                    .tint(current ? Theme.apricot : nil)
                }
            }
        }
        .scrollClipDisabled()
    }
}
