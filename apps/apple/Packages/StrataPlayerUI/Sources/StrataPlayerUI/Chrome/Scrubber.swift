import SwiftUI
import StrataDesign
import StrataKit
#if os(tvOS)
import UIKit
#endif

/// Seek bar in media time: buffered and played ranges, chapter ticks, and a
/// time/chapter preview while scrubbing. Touch drags on iPhone/iPad; on tvOS
/// it's focusable and scrubs with the remote (a swipe on the touch surface moves in
/// proportion, left/right clicks by 10 seconds, select commits).
public struct Scrubber: View {
    let position: TimeInterval
    let duration: TimeInterval
    let chapters: [Chapter]
    let onScrub: (TimeInterval) -> Void
    /// True while someone is dragging or scrubbing, so the controls can stay up.
    let onScrubbing: (Bool) -> Void
    /// Shown as a play / pause glyph by the elapsed time (the TV's player).
    let isPlaying: Bool?
    /// Select on the bar when not scrubbing (tvOS): play or pause.
    let onSelect: (() -> Void)?

    @State private var scrubValue: TimeInterval?
    #if os(tvOS)
    @FocusState private var focused: Bool
    /// Where a swipe on the touch surface started from.
    @State private var swipeBase: TimeInterval?
    /// A swipe ends in a move command too: that one shouldn't add 10 seconds on top.
    @State private var swipeEnded = Date.distantPast
    /// A swipe the bar's width across moves this share of the title.
    private static let swipeShare: Double = 0.25
    #endif

    public init(position: TimeInterval, duration: TimeInterval, chapters: [Chapter] = [],
                isPlaying: Bool? = nil, onSelect: (() -> Void)? = nil,
                onScrubbing: @escaping (Bool) -> Void = { _ in }, onScrub: @escaping (TimeInterval) -> Void) {
        self.position = position
        self.duration = duration
        self.chapters = chapters
        self.isPlaying = isPlaying
        self.onSelect = onSelect
        self.onScrubbing = onScrubbing
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
    private let trackHeight: CGFloat = 7
    #else
    private let trackHeight: CGFloat = 6
    #endif

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.25))
                    Capsule().fill(fill).frame(width: max(trackHeight, w * fraction))
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
                #if os(tvOS)
                .background(RemotePan(isEnabled: focused && duration > 0) { travel in swiped(travel, width: w) })
                #else
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
                guard duration > 0, swipeBase == nil, Date.now.timeIntervalSince(swipeEnded) > 0.3 else { return }
                let step: TimeInterval = 10
                let base = scrubValue ?? position
                switch direction {
                case .left: scrubValue = max(0, base - step)
                case .right: scrubValue = min(duration, base + step)
                default: break
                }
            }
            .onTapGesture {
                if let scrubValue { onScrub(scrubValue) } else { onSelect?() }
                scrubValue = nil
            }
            .onChange(of: focused) { _, isFocused in if !isFocused { scrubValue = nil; swipeBase = nil } }
            #endif

            .onChange(of: scrubValue != nil) { _, scrubbing in onScrubbing(scrubbing) }

            HStack(spacing: Metrics.space2) {
                Text(Self.format(shown))
                if let isPlaying {
                    Image(systemName: isPlaying ? "pause.circle" : "play.circle")
                        .contentTransition(.symbolEffect(.replace))
                        .accessibilityHidden(true)
                }
                Spacer()
                // Time left, with a minus sign as Apple's players show it.
                Text("\u{2212}\(Self.format(max(0, duration - shown)))")
            }
            .font(timeFont)
            .foregroundStyle(Theme.onArtwork.opacity(0.8))
        }
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue("\(Self.spoken(position)) of \(Self.spoken(duration))")
        .accessibilityAdjustableAction { direction in
            onScrub(direction == .increment ? min(duration, position + 10) : max(0, position - 10))
        }
    }

    #if os(tvOS)
    /// A swipe on the touch surface moves the preview in proportion to how far it went;
    /// the preview stays when the finger lifts, for select to commit (as the clicks do).
    private func swiped(_ travel: CGFloat?, width: CGFloat) {
        guard let travel else {
            if swipeBase != nil { swipeEnded = .now }
            swipeBase = nil
            return
        }
        let base = swipeBase ?? scrubValue ?? position
        swipeBase = base
        let seconds = Double(travel / max(width, 1)) * duration * Self.swipeShare
        scrubValue = min(duration, max(0, base + seconds))
    }
    #endif

    /// Small and tabular on the TV, like its player's; the footnote timecode elsewhere.
    private var timeFont: Font {
        #if os(tvOS)
        .system(size: 24, weight: .semibold, design: .monospaced).monospacedDigit()
        #else
        .stTimecode
        #endif
    }

    /// The played part: white on the TV, like its player; apricot elsewhere.
    private var fill: Color {
        #if os(tvOS)
        Theme.onArtwork
        #else
        Theme.apricot
        #endif
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

    /// "1:02:03", or "4:05" under an hour, in the locale's digits and separators.
    public static func format(_ t: TimeInterval) -> String {
        let duration = Duration.seconds(t.isFinite ? max(0, Int(t)) : 0)
        return duration.formatted(.time(pattern: t >= 3600 ? .hourMinuteSecond : .minuteSecond))
    }

    /// "1 hour, 2 minutes, 3 seconds", for VoiceOver.
    static func spoken(_ t: TimeInterval) -> String {
        Duration.seconds(t.isFinite ? max(0, Int(t)) : 0)
            .formatted(.units(allowed: [.hours, .minutes, .seconds], width: .wide))
    }
}

#if os(tvOS)
/// Swipes on the Siri Remote's touch surface, for scrubbing in proportion to the swipe.
/// The remote's touches go to the window, not to SwiftUI's focused view, so the pan
/// sits on the window while this (empty) view is on screen and only acts while enabled.
private struct RemotePan: UIViewRepresentable {
    let isEnabled: Bool
    /// The swipe's horizontal travel so far; `nil` when it ends.
    let onChange: (CGFloat?) -> Void

    func makeUIView(context: Context) -> Host { Host() }

    func updateUIView(_ view: Host, context: Context) {
        view.onChange = onChange
        view.pan.isEnabled = isEnabled
    }

    static func dismantleUIView(_ view: Host, coordinator: ()) {
        view.pan.view?.removeGestureRecognizer(view.pan)
    }

    final class Host: UIView, UIGestureRecognizerDelegate {
        let pan = UIPanGestureRecognizer()
        var onChange: (CGFloat?) -> Void = { _ in }

        init() {
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirect.rawValue)]
            // Clicks and the focus engine's own swipes carry on as before.
            pan.cancelsTouchesInView = false
            pan.delegate = self
            pan.addTarget(self, action: #selector(panned))
        }

        required init?(coder: NSCoder) { fatalError() }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            pan.view?.removeGestureRecognizer(pan)
            window?.addGestureRecognizer(pan)
        }

        @objc private func panned(_ pan: UIPanGestureRecognizer) {
            switch pan.state {
            case .began, .changed: onChange(pan.translation(in: pan.view).x)
            default: onChange(nil)
            }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
#endif
