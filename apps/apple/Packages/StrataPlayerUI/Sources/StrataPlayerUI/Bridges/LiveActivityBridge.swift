#if canImport(ActivityKit) && os(iOS)
import Foundation
import ActivityKit
import StrataKit

/// Pushes the current playback state into the Lock Screen / Dynamic Island
/// via `ActivityKit`. The widget extension target consumes the same
/// `StrataNowPlayingAttributes` type definition (re-declared in the widget
/// bundle to keep the two targets independent).
@MainActor
public final class LiveActivityBridge {
    public static let shared = LiveActivityBridge()
    private var activity: Activity<Attributes>?

    private init() {}

    public func start(itemId: String, title: String, subtitle: String?, artworkURL: URL?, duration: TimeInterval) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        end()
        let attrs = Attributes(itemId: itemId, title: title, subtitle: subtitle, artworkURL: artworkURL)
        let state = Attributes.ContentState(position: 0, duration: duration, isPaused: false)
        do {
            self.activity = try Activity<Attributes>.request(
                attributes: attrs,
                content: .init(state: state, staleDate: nil)
            )
        } catch {
            // best-effort
        }
    }

    public func update(position: TimeInterval, duration: TimeInterval, isPaused: Bool) {
        guard let activity else { return }
        let state = Attributes.ContentState(position: position, duration: duration, isPaused: isPaused)
        Task { await activity.update(.init(state: state, staleDate: nil)) }
    }

    public func end() {
        guard let activity else { return }
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
        self.activity = nil
    }

    /// Local mirror of the widget-extension type. Keep field names + types in
    /// sync with `StrataWidgets/StrataNowPlayingActivity.swift`.
    public struct Attributes: ActivityAttributes {
        public struct ContentState: Codable, Hashable {
            public var position: TimeInterval
            public var duration: TimeInterval
            public var isPaused: Bool
        }
        public let itemId: String
        public let title: String
        public let subtitle: String?
        public let artworkURL: URL?
    }
}
#endif
