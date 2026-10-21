import UIKit
import StrataFeatures

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Lets the lock screen, Control Center and headphones drive playback.
        UIApplication.shared.beginReceivingRemoteControlEvents()
        return true
    }

    #if os(iOS)
    /// Landscape only while the player is up on iPhone (PlayerOrientation).
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        PlayerOrientation.allowed
    }
    #endif
}
