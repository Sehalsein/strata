import SwiftUI
import MediaAccessibility
import CoreText
import StrataDesign
import StrataKit
#if canImport(UIKit)
import UIKit
#endif

/// The active subtitle cue, centered above the controls.
public struct SubtitleOverlay: View {
    @Bindable var engine: PlayerEngine
    let raised: Bool

    public init(engine: PlayerEngine, raised: Bool = false) {
        self.engine = engine
        self.raised = raised
    }

    /// The caption style from Settings (Accessibility > Subtitles & Captioning).
    @State private var style = CaptionStyle.current

    public var body: some View {
        ZStack {
            pictures
            lines
        }
    }

    /// Picture subtitles (PGS, VobSub), where they were authored on the video's frame.
    private var pictures: some View {
        GeometryReader { geo in
            let frame = videoFrame(in: geo.size)
            // By position, not by value: hashing the PNGs on every redraw isn't free.
            ForEach(Array(engine.activeCueImages.enumerated()), id: \.offset) { _, image in
                if let cg = engine.picture(image) {
                    let width = image.width * frame.width, height = image.height * frame.height
                    // Lifted above the controls when they show.
                    let bottom = frame.minY + (image.y + image.height) * frame.height
                    let lift = raised ? max(0, bottom - (geo.size.height - Self.raisedInset)) : 0
                    Image(decorative: cg, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: width, height: height)
                        .position(x: frame.minX + image.x * frame.width + width / 2,
                                  y: frame.minY + image.y * frame.height + height / 2 - lift)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    #if os(tvOS)
    private static let raisedInset: CGFloat = 400
    #else
    private static let raisedInset: CGFloat = 180
    #endif

    /// Where the video sits on screen, as the player layer fits or fills it.
    private func videoFrame(in size: CGSize) -> CGRect {
        guard let video = engine.videoSize, size.width > 0, size.height > 0 else { return CGRect(origin: .zero, size: size) }
        let fit = min(size.width / video.width, size.height / video.height)
        let fill = max(size.width / video.width, size.height / video.height)
        let scale = engine.videoGravity == .resizeAspectFill ? fill : fit
        let w = video.width * scale, h = video.height * scale
        return CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
    }

    private var lines: some View {
        VStack {
            Spacer()
            if let text = engine.activeCueText {
                Text(text)
                    .font(style.font)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(style.foreground)
                    .modifier(CaptionEdge(edge: style.edge))
                    .padding(.horizontal, Metrics.space4)
                    .padding(.vertical, Metrics.space2)
                    .background(style.background, in: RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous))
                    .transition(.opacity)
            }
        }
        .padding(.bottom, raised ? Self.raisedInset : 48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeOut(duration: 0.15), value: engine.activeCueText)
        .allowsHitTesting(false)
        .onReceive(NotificationCenter.default.publisher(for: CaptionStyle.changed)) { _ in style = .current }
    }
}

/// How subtitle text is drawn: the system caption style where the user set one, else
/// Strata's own (white semibold on a soft dark box, with a shadow).
struct CaptionStyle {
    enum Edge { case strataShadow, none, dropShadow, raised, depressed, uniform }

    var font: Font
    var foreground: Color
    var background: Color
    var edge: Edge

    static let changed = Notification.Name(kMACaptionAppearanceSettingsChangedNotification as String)

    #if os(tvOS)
    private static let baseSize: CGFloat = 44
    #elseif canImport(UIKit)
    private static var baseSize: CGFloat { UIFont.preferredFont(forTextStyle: .title3).pointSize }
    #else
    private static let baseSize: CGFloat = 20
    #endif

    /// Read from MediaAccessibility. A setting is used when the user made it override
    /// video (or, for size, changed it); anything else keeps Strata's look.
    static var current: CaptionStyle {
        let domain = MACaptionAppearanceDomain.user
        var behavior = MACaptionAppearanceBehavior.useContentIfAvailable

        let scale = MACaptionAppearanceGetRelativeCharacterSize(domain, &behavior)
        let size = baseSize * (scale > 0 ? scale : 1)
        var font: Font
        #if os(tvOS)
        font = .system(size: size, weight: .semibold)
        #else
        font = scale > 0 && scale != 1 ? .system(size: size, weight: .semibold) : .title3.weight(.semibold)
        #endif
        behavior = .useContentIfAvailable
        let descriptor = MACaptionAppearanceCopyFontDescriptorForStyle(domain, &behavior, .default).takeRetainedValue()
        if behavior == .useValue, let name = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String {
            font = .custom(name, fixedSize: size)
        }

        var foreground = Color.white
        behavior = .useContentIfAvailable
        let fg = MACaptionAppearanceCopyForegroundColor(domain, &behavior).takeRetainedValue()
        var fgOpacityBehavior = MACaptionAppearanceBehavior.useContentIfAvailable
        let fgOpacity = MACaptionAppearanceGetForegroundOpacity(domain, &fgOpacityBehavior)
        if behavior == .useValue || fgOpacityBehavior == .useValue {
            foreground = Color(cgColor: fg).opacity(fgOpacity)
        }

        var background = Color.black.opacity(0.45)
        behavior = .useContentIfAvailable
        let bg = MACaptionAppearanceCopyBackgroundColor(domain, &behavior).takeRetainedValue()
        var bgOpacityBehavior = MACaptionAppearanceBehavior.useContentIfAvailable
        let bgOpacity = MACaptionAppearanceGetBackgroundOpacity(domain, &bgOpacityBehavior)
        if behavior == .useValue || bgOpacityBehavior == .useValue {
            background = Color(cgColor: bg).opacity(bgOpacity)
        }

        var edge = Edge.strataShadow
        behavior = .useContentIfAvailable
        let edgeStyle = MACaptionAppearanceGetTextEdgeStyle(domain, &behavior)
        if behavior == .useValue {
            switch edgeStyle {
            case .none: edge = .none
            case .dropShadow: edge = .dropShadow
            case .raised: edge = .raised
            case .depressed: edge = .depressed
            case .uniform: edge = .uniform
            default: break
            }
        }
        return CaptionStyle(font: font, foreground: foreground, background: background, edge: edge)
    }
}

/// The caption text's edge: a shadow, raised, depressed or outlined.
private struct CaptionEdge: ViewModifier {
    let edge: CaptionStyle.Edge

    func body(content: Content) -> some View {
        switch edge {
        case .strataShadow: content.shadow(color: .black.opacity(0.9), radius: 3, y: 1)
        case .none: content
        case .dropShadow: content.shadow(color: .black.opacity(0.8), radius: 2, x: 1.5, y: 1.5)
        case .raised: content.shadow(color: .black.opacity(0.9), radius: 0, x: 0, y: -1)
        case .depressed: content.shadow(color: .black.opacity(0.9), radius: 0, x: 0, y: 1)
        case .uniform:
            content
                .shadow(color: .black, radius: 0, x: 1, y: 0)
                .shadow(color: .black, radius: 0, x: -1, y: 0)
                .shadow(color: .black, radius: 0, x: 0, y: 1)
                .shadow(color: .black, radius: 0, x: 0, y: -1)
        }
    }
}

/// "Up Next" card that counts down to the next episode.
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
                Text("Up Next in \(countdown)s").eyebrowStyle(Theme.accentText)
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
        // A plain dark material, not glass: the buttons on it are glass already.
        .background {
            RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous)
                .fill(.regularMaterial)
                .environment(\.colorScheme, .dark)
        }
        .frame(maxWidth: 520)
    }
}

/// What's playing and how: shown from the player's info button.
public struct StreamDetailsPanel: View {
    let session: PlayResponse?
    /// Device mode: data read from the file so far.
    let bytesRead: Int64?

    public init(session: PlayResponse?, bytesRead: Int64? = nil) {
        self.session = session
        self.bytesRead = bytesRead
    }

    /// The audio line, saying when DTS or TrueHD is being decoded on the device.
    private func audio(_ session: PlayResponse) -> String {
        let title = session.selectedAudio?.displayTitle ?? "—"
        guard session.mode == .device, let plan = session.remux, plan.audio != "copy" else { return title }
        return title + " → Lossless (ALAC)"
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            Text("Stream Details").font(.stTitle2).foregroundStyle(Theme.ink)
            if let session {
                let c = session.candidate
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Metrics.space4, verticalSpacing: Metrics.space3) {
                    row("Source", c.provider.label)
                    row("File", c.displayName)
                    row("Playback", session.mode.label)
                    row("Video", [c.resolutionLabel, c.codecLabel, c.hdrLabel].compactMap { $0 }.joined(separator: " · "))
                    row("Audio", audio(session))
                    if let size = c.sizeLabel { row("Size", size) }
                    if session.mode == .device, let bytesRead, bytesRead > 0, let read = Formatting.size(bytes: Int(bytesRead)) {
                        row("Read", read)
                    }
                }
                if !session.reasons.isEmpty {
                    Text(session.reasons.joined(separator: "; "))
                        .font(.stFootnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Nothing is playing.").font(.stCallout).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, Metrics.space6)
        .padding(.top, Metrics.space8)
        .padding(.bottom, Metrics.space6)
        // Pin to the top of the sheet instead of floating in the middle of it.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .presentationDragIndicator(.visible)
    }

    // Labels use the vibrant secondary color: the sheet is glass, where ink-3 doesn't read.
    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).font(.stFootnote).foregroundStyle(.secondary)
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
                    .buttonStyle(.strataGlass)
                    .tint(current ? Theme.apricot : nil)
                }
            }
        }
        .scrollClipDisabled()
    }
}
