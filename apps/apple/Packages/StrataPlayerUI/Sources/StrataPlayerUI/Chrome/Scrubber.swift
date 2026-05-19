import SwiftUI
import StrataDesign
import StrataKit

/// Editorial scrubber with chapter ticks and an optional trickplay preview.
/// The thumbnail provider is injected so this view stays free of network
/// concerns — the host (`TransportBar`) wires it up.
public struct Scrubber: View {
    public let position: TimeInterval
    public let duration: TimeInterval
    public let chapters: [Chapter]
    public let trickplayProvider: TrickplayProvider?
    public let onScrub: (TimeInterval) -> Void

    @State private var dragValue: Double?
    @State private var isHovering = false
    @State private var hoverPosition: TimeInterval?

    public init(position: TimeInterval,
                duration: TimeInterval,
                chapters: [Chapter] = [],
                trickplayProvider: TrickplayProvider? = nil,
                onScrub: @escaping (TimeInterval) -> Void) {
        self.position = position
        self.duration = duration
        self.chapters = chapters
        self.trickplayProvider = trickplayProvider
        self.onScrub = onScrub
    }

    public var body: some View {
        let value = dragValue ?? (duration > 0 ? position / duration : 0)
        GeometryReader { geo in
            let w = geo.size.width
            let knobX = max(0, min(w, CGFloat(value) * w))
            ZStack(alignment: .leading) {
                // track
                Rectangle().fill(Strata.Tokens.paper.opacity(0.16))
                    .frame(height: isHovering ? 4 : 2)
                // played
                Rectangle().fill(Strata.Tokens.accent2)
                    .frame(width: knobX, height: isHovering ? 4 : 2)
                // chapter ticks
                ForEach(chapters.indices, id: \.self) { i in
                    let chapter = chapters[i]
                    let seconds = TimeInterval(chapter.startPositionTicks) / 10_000_000
                    if duration > 0, seconds > 0, seconds < duration {
                        Rectangle()
                            .fill(Strata.Tokens.paper.opacity(0.6))
                            .frame(width: 1, height: 8)
                            .offset(x: CGFloat(seconds / duration) * w)
                    }
                }
                // knob
                Rectangle().fill(Strata.Tokens.paper)
                    .frame(width: 2, height: 14)
                    .offset(x: knobX - 1)
                    .opacity(isHovering || dragValue != nil ? 1 : 0)
                // trickplay preview
                if let hover = hoverPosition, let trickplayProvider, duration > 0 {
                    TrickplayPreview(seconds: hover, chapter: chapter(at: hover), provider: trickplayProvider)
                        .offset(x: CGFloat(hover / duration) * w - 60, y: -120)
                }
            }
            .contentShape(Rectangle().inset(by: -8))
            #if !os(tvOS)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        let raw = max(0, min(w, g.location.x))
                        let progress = Double(raw / max(w, 1))
                        self.dragValue = progress
                        if duration > 0 { self.hoverPosition = progress * duration }
                    }
                    .onEnded { _ in
                        if let v = dragValue, duration > 0 {
                            onScrub(v * duration)
                        }
                        dragValue = nil
                        hoverPosition = nil
                    }
            )
            #endif
            #if os(macOS)
            .onContinuousHover { phase in
                switch phase {
                case .active(let point):
                    isHovering = true
                    if duration > 0 {
                        let progress = max(0, min(1, Double(point.x / max(w, 1))))
                        hoverPosition = progress * duration
                    }
                case .ended:
                    isHovering = false
                    hoverPosition = nil
                }
            }
            #endif
        }
        .frame(height: 18)
    }

    private func chapter(at seconds: TimeInterval) -> Chapter? {
        chapters.last(where: { TimeInterval($0.startPositionTicks) / 10_000_000 <= seconds })
    }
}

private struct TrickplayPreview: View {
    let seconds: TimeInterval
    let chapter: Chapter?
    let provider: TrickplayProvider

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TrickplayThumbnail(seconds: seconds, provider: provider)
                .frame(width: 160, height: 90)
                .strataCard()
                .strataBorder(Strata.Tokens.paperHair)
            if let chapter, let name = chapter.name {
                Text(name.uppercased())
                    .font(.mono(9))
                    .tracking(1.4)
                    .foregroundStyle(Strata.Tokens.paperDim)
            }
            Text(format(seconds))
                .font(.mono(10))
                .foregroundStyle(Strata.Tokens.paper)
        }
        .allowsHitTesting(false)
    }

    private func format(_ t: TimeInterval) -> String {
        let total = Int(t)
        let m = (total % 3600) / 60, s = total % 60, h = total / 3600
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}
