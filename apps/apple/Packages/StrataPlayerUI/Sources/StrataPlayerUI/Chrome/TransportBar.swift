import SwiftUI
import StrataDesign
import StrataKit

public struct TransportBar: View {
    @Bindable public var engine: PlayerEngine
    public let trickplayProvider: TrickplayProvider?
    public let onClose: (() -> Void)?
    public let onShowDetails: (() -> Void)?
    public let onTogglePiP: (() -> Void)?

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var hSizeClass
    private var isCompact: Bool { hSizeClass == .compact }
    #else
    // macOS and tvOS always use the regular (wide) layout.
    private var isCompact: Bool { false }
    #endif

    public init(engine: PlayerEngine,
                trickplayProvider: TrickplayProvider? = nil,
                onClose: (() -> Void)? = nil,
                onShowDetails: (() -> Void)? = nil,
                onTogglePiP: (() -> Void)? = nil) {
        self.engine = engine
        self.trickplayProvider = trickplayProvider
        self.onClose = onClose
        self.onShowDetails = onShowDetails
        self.onTogglePiP = onTogglePiP
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            titleRow
            Scrubber(
                position: engine.position,
                duration: engine.duration,
                chapters: engine.item?.chapters ?? [],
                trickplayProvider: trickplayProvider
            ) { newPos in
                Task { await engine.seek(to: newPos) }
            }
            HStack {
                Text(format(engine.position)).strataSpec()
                Spacer()
                Text("−" + format(max(0, engine.duration - engine.position))).strataSpec()
            }
            if isCompact {
                compactControls
            } else {
                regularControls
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [.clear, .black.opacity(0.55), .black.opacity(0.85)],
                startPoint: .top, endPoint: .bottom
            )
        )
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let item = engine.item {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.displayTitle)
                        .font(.fraunces(20, opticalSize: 60, soft: 40))
                        .foregroundStyle(Strata.Tokens.paper)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if let series = item.seriesName, item.type == .episode {
                        HStack(spacing: 6) {
                            Text(series).strataSpec().lineLimit(1)
                            if let s = item.parentIndexNumber, let e = item.indexNumber {
                                Text("S\(s) · E\(e)").strataSpec()
                            }
                        }
                    }
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            } else {
                Spacer(minLength: 0)
            }
            if let onShowDetails {
                CompactControlButton(systemImage: "info.circle", action: onShowDetails)
            }
            if let onTogglePiP {
                CompactControlButton(systemImage: "pip.enter", action: onTogglePiP)
            }
            if let onClose {
                CompactControlButton(systemImage: "xmark", action: onClose, isCircle: true)
            }
        }
    }

    private var playPauseButton: some View {
        Button(action: engine.togglePlay) {
            Image(systemName: engine.status == .playing ? "pause.fill" : "play.fill")
                .font(.system(size: isCompact ? 20 : 22, weight: .semibold))
                .foregroundStyle(Strata.Tokens.bg)
                .frame(width: isCompact ? 52 : 56, height: isCompact ? 52 : 56)
                .background(Strata.Tokens.paper)
                .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
        }
        .buttonStyle(.plain)
    }

    private var compactControls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 18) {
                CompactControlButton(systemImage: "gobackward.10") { Task { await engine.skip(-10) } }
                playPauseButton
                CompactControlButton(systemImage: "goforward.10") { Task { await engine.skip(10) } }
            }
            .frame(maxWidth: .infinity)

            HStack(spacing: 6) {
                Spacer(minLength: 0)
                SpeedMenu(engine: engine)
                AudioMenu(engine: engine)
                SubtitleMenu(engine: engine)
                AirPlayRoutePicker()
                    .frame(width: 36, height: 36)
                CompactControlButton(systemImage: engine.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill") {
                    engine.toggleMute()
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var regularControls: some View {
        HStack(spacing: 14) {
            ControlButton(systemImage: "gobackward.10") { Task { await engine.skip(-10) } }
            playPauseButton
            ControlButton(systemImage: "goforward.10") { Task { await engine.skip(10) } }
            Spacer()
            SpeedMenu(engine: engine)
            AudioMenu(engine: engine)
            SubtitleMenu(engine: engine)
            AirPlayRoutePicker()
                .frame(width: 32, height: 32)
            ControlButton(systemImage: engine.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill") {
                engine.toggleMute()
            }
        }
    }

    private func format(_ t: TimeInterval) -> String {
        guard t.isFinite, t >= 0 else { return "00:00" }
        let total = Int(t)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}

public struct ControlButton: View {
    public let systemImage: String
    public let action: () -> Void

    public init(systemImage: String, action: @escaping () -> Void) {
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Strata.Tokens.paper)
                .frame(width: 44, height: 44)
                .background(Strata.Tokens.paper.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
        }
        .buttonStyle(.plain)
    }
}

/// Smaller control variant — used in the iPhone-portrait compact layout where
/// space is tight. Optional `isCircle` for the close button.
struct CompactControlButton: View {
    let systemImage: String
    let action: () -> Void
    var isCircle: Bool = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Strata.Tokens.paper)
                .frame(width: 36, height: 36)
                .background(Strata.Tokens.paper.opacity(0.08))
                .clipShape(
                    isCircle
                    ? AnyShape(Circle())
                    : AnyShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
                )
        }
        .buttonStyle(.plain)
    }
}
