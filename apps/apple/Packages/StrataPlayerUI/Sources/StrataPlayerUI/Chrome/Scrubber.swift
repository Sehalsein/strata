import SwiftUI
import StrataDesign
import StrataKit

/// Seek bar in media time: buffered and played ranges, chapter ticks, and a
/// time/chapter preview while scrubbing. Touch drags on iPhone/iPad; on tvOS
/// it's focusable and scrubs with the remote (left/right, select to commit).
public struct Scrubber: View {
    let position: TimeInterval
    let duration: TimeInterval
    let chapters: [Chapter]
    let onScrub: (TimeInterval) -> Void

    @State private var scrubValue: TimeInterval?
    #if os(tvOS)
    @FocusState private var focused: Bool
    #endif

    public init(position: TimeInterval, duration: TimeInterval, chapters: [Chapter] = [], onScrub: @escaping (TimeInterval) -> Void) {
        self.position = position
        self.duration = duration
        self.chapters = chapters
        self.onScrub = onScrub
    }

    private var shown: TimeInterval { scrubValue ?? position }
    private var fraction: Double { duration > 0 ? min(max(shown / duration, 0), 1) : 0 }
    private var isActive: Bool {
        #if os(tvOS)
        focused || scrubValue != nil
        #else
        scrubValue != nil
        #endif
    }

    #if os(tvOS)
    private let trackHeight: CGFloat = 10
    #else
    private let trackHeight: CGFloat = 6
    #endif

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.25))
                    Capsule().fill(Theme.apricot).frame(width: max(trackHeight, w * fraction))
                    ForEach(Array(chapters.enumerated()), id: \.offset) { _, chapter in
                        if duration > 0, chapter.start > 0, chapter.start < duration {
                            Rectangle().fill(.white.opacity(0.6))
                                .frame(width: 2, height: trackHeight + 4)
                                .offset(x: w * chapter.start / duration - 1)
                        }
                    }
                    Circle().fill(Theme.onArtwork)
                        .frame(width: trackHeight * 2.6, height: trackHeight * 2.6)
                        .shadow(color: .black.opacity(0.3), radius: 4)
                        .offset(x: w * fraction - trackHeight * 1.3)
                        .opacity(isActive ? 1 : 0)
                    if let scrubValue {
                        preview(scrubValue)
                            .fixedSize()
                            .offset(x: min(max(0, w * fraction - 50), w - 100), y: -44)
                    }
                }
                .frame(height: trackHeight)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                #if !os(tvOS)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { g in
                            guard duration > 0 else { return }
                            scrubValue = Double(max(0, min(w, g.location.x)) / max(w, 1)) * duration
                        }
                        .onEnded { _ in
                            if let scrubValue { onScrub(scrubValue) }
                            scrubValue = nil
                        }
                )
                #endif
            }
            .frame(height: trackHeight * 3)
            #if os(tvOS)
            .focusable()
            .focused($focused)
            .onMoveCommand { direction in
                guard duration > 0 else { return }
                let step: TimeInterval = 10
                let base = scrubValue ?? position
                switch direction {
                case .left: scrubValue = max(0, base - step)
                case .right: scrubValue = min(duration, base + step)
                default: break
                }
            }
            .onTapGesture {
                if let scrubValue { onScrub(scrubValue) }
                scrubValue = nil
            }
            .onChange(of: focused) { _, isFocused in if !isFocused { scrubValue = nil } }
            #endif

            HStack {
                Text(Self.format(shown))
                Spacer()
                Text("−" + Self.format(max(0, duration - shown)))
            }
            .font(.stTimecode)
            .foregroundStyle(Theme.onArtwork.opacity(0.8))
        }
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue("\(Self.format(position)) of \(Self.format(duration))")
        .accessibilityAdjustableAction { direction in
            onScrub(direction == .increment ? min(duration, position + 10) : max(0, position - 10))
        }
    }

    private func preview(_ seconds: TimeInterval) -> some View {
        VStack(spacing: 2) {
            if let title = chapters.last(where: { $0.start <= seconds })?.title {
                Text(title).font(.stFootnote).lineLimit(1)
            }
            Text(Self.format(seconds)).font(.stTimecode)
        }
        .foregroundStyle(Theme.onArtwork)
        .padding(.horizontal, Metrics.space3)
        .padding(.vertical, Metrics.space2)
        .glassEffect(.regular, in: .capsule)
        .frame(width: 100)
    }

    public static func format(_ t: TimeInterval) -> String {
        guard t.isFinite, t >= 0 else { return "0:00" }
        let total = Int(t)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
