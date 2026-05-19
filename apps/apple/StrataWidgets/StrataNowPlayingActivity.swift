#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import WidgetKit
import SwiftUI

public struct StrataNowPlayingAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var position: TimeInterval
        public var duration: TimeInterval
        public var isPaused: Bool

        public init(position: TimeInterval, duration: TimeInterval, isPaused: Bool) {
            self.position = position
            self.duration = duration
            self.isPaused = isPaused
        }
    }

    public var itemId: String
    public var title: String
    public var subtitle: String?
    public var artworkURL: URL?

    public init(itemId: String, title: String, subtitle: String? = nil, artworkURL: URL? = nil) {
        self.itemId = itemId
        self.title = title
        self.subtitle = subtitle
        self.artworkURL = artworkURL
    }
}

struct StrataNowPlayingActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: StrataNowPlayingAttributes.self) { context in
            LockScreenView(context: context)
                .padding()
                .activityBackgroundTint(Color(red: 0.047, green: 0.039, blue: 0.031))
                .activitySystemActionForegroundColor(Color(red: 0.953, green: 0.914, blue: 0.827))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ArtworkView(url: context.attributes.artworkURL)
                        .frame(width: 36, height: 54)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Image(systemName: context.state.isPaused ? "pause.fill" : "play.fill")
                        .font(.system(size: 18, weight: .semibold))
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        if let sub = context.attributes.subtitle {
                            Text(sub).font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressBar(state: context.state)
                }
            } compactLeading: {
                Image(systemName: "film").foregroundStyle(.tint)
            } compactTrailing: {
                Text(formatRemaining(state: context.state))
                    .font(.system(.caption, design: .monospaced))
            } minimal: {
                Image(systemName: context.state.isPaused ? "pause.fill" : "play.fill")
            }
        }
    }

    private func formatRemaining(state: StrataNowPlayingAttributes.ContentState) -> String {
        let remaining = max(0, state.duration - state.position)
        let total = Int(remaining)
        let m = total / 60, s = total % 60
        return String(format: "%02d:%02d", m, s)
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<StrataNowPlayingAttributes>
    var body: some View {
        HStack(spacing: 12) {
            ArtworkView(url: context.attributes.artworkURL)
                .frame(width: 48, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 2))
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                if let sub = context.attributes.subtitle {
                    Text(sub).font(.caption).foregroundStyle(.secondary)
                }
                ProgressBar(state: context.state)
            }
        }
    }
}

private struct ArtworkView: View {
    let url: URL?
    var body: some View {
        if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img): img.resizable().scaledToFill()
                default: Color.gray.opacity(0.3)
                }
            }
        } else {
            Color.gray.opacity(0.3)
        }
    }
}

private struct ProgressBar: View {
    let state: StrataNowPlayingAttributes.ContentState
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.white.opacity(0.18)).frame(height: 2)
                Rectangle().fill(Color(red: 0.91, green: 0.20, blue: 0.12))
                    .frame(width: progress(width: geo.size.width), height: 2)
            }
        }
        .frame(height: 2)
    }

    private func progress(width: CGFloat) -> CGFloat {
        guard state.duration > 0 else { return 0 }
        return CGFloat(state.position / state.duration) * width
    }
}
#endif
