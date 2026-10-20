import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Lets the lock screen, Control Center and headphones drive playback.
        UIApplication.shared.beginReceivingRemoteControlEvents()
        return true
    }
}
