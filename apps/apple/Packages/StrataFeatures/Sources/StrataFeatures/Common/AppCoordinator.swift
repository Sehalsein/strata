import SwiftUI
#if canImport(CoreSpotlight) && !os(tvOS)
import CoreSpotlight
#endif
import StrataKit

/// Translates external triggers (deep links, Handoff payloads, Spotlight
/// taps) into route requests the active shell consumes. Each shell observes
/// `pendingRoute` and appends it to its navigation stack when set.
@MainActor
@Observable
public final class AppCoordinator {
    public var pendingRoute: Route?
    public var pendingTab: AppSection?

    public init() {}

    public func handle(url: URL) {
        guard let dest = DeepLink.parse(url) else { return }
        switch dest {
        case .item(let id):
            pendingRoute = .unified(id: id)
        case .watch(let id, let t):
            pendingRoute = .watch(.init(itemId: id, startSeconds: t))
        }
    }

    public func handle(spotlightActivity activity: NSUserActivity) {
        #if canImport(CoreSpotlight) && !os(tvOS)
        guard activity.activityType == CSSearchableItemActionType,
              let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              let itemId = Spotlight.itemId(from: id) else { return }
        pendingRoute = .unified(id: itemId)
        #endif
    }

    public func handle(userActivity: NSUserActivity) {
        switch userActivity.activityType {
        case Handoff.viewingActivityType:
            if let id = userActivity.userInfo?["itemId"] as? String {
                pendingRoute = .unified(id: id)
            }
        case Handoff.watchingActivityType:
            if let id = userActivity.userInfo?["itemId"] as? String {
                let pos = userActivity.userInfo?["position"] as? TimeInterval
                pendingRoute = .watch(.init(itemId: id, startSeconds: pos))
            }
        default: break
        }
    }

    public func requestWatch(_ itemId: String, start: TimeInterval? = nil) {
        pendingRoute = .watch(.init(itemId: itemId, startSeconds: start))
    }

    public func requestDetail(_ itemId: String) {
        pendingRoute = .unified(id: itemId)
    }

    public func consumeRoute() -> Route? {
        defer { pendingRoute = nil }
        return pendingRoute
    }
}

