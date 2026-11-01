import UIKit
import UserNotifications
import StrataFeatures
import StrataKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Lets the lock screen, Control Center and headphones drive playback.
        UIApplication.shared.beginReceivingRemoteControlEvents()
        #if os(iOS)
        UNUserNotificationCenter.current().delegate = self
        #endif
        return true
    }

    #if os(iOS)
    /// Downloads finished (or need attention) while the app was closed: the store takes the
    /// session's events and calls this when it has handled them.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        DownloadStore.shared.backgroundCompletion = completionHandler
    }

    /// Landscape only while the player is up on iPhone (PlayerOrientation).
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        PlayerOrientation.allowed
    }
    #endif
}

#if os(iOS)
/// New-episode notifications (EpisodeAlerts): shown while the app is open too, and a tap
/// opens the show through its deep link.
extension AppDelegate: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let link = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: link) else { return }
        await MainActor.run { UIApplication.shared.open(url) }
    }
}
#endif
