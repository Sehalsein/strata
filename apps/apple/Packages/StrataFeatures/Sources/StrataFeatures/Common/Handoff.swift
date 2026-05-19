import SwiftUI
import StrataKit

public enum Handoff {
    public static let viewingActivityType = "com.strata.viewing"
    public static let watchingActivityType = "com.strata.watching"
}

public extension View {
    /// Attach a Handoff activity for a detail screen. Other devices on the
    /// same iCloud account can pick up the activity in the dock / lockscreen
    /// and jump straight to this item.
    ///
    /// Note: `webpageURL` is intentionally not set. NSUserActivity requires it
    /// to be an HTTP/HTTPS URL and throws if not — our custom `strata://`
    /// scheme is delivered separately via `.onOpenURL` and `userInfo`.
    func handoffForViewing(item: BaseItem) -> some View {
        self.userActivity(Handoff.viewingActivityType, isActive: true) { activity in
            activity.title = item.displayTitle
            activity.userInfo = ["itemId": item.id]
            activity.isEligibleForHandoff = true
            activity.isEligibleForSearch = true
        }
    }

    func handoffForWatching(itemId: String, position: TimeInterval) -> some View {
        self.userActivity(Handoff.watchingActivityType, isActive: true) { activity in
            activity.title = "Continue watching"
            activity.userInfo = ["itemId": itemId, "position": position]
            activity.isEligibleForHandoff = true
        }
    }
}
