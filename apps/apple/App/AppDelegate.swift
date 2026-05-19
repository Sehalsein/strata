#if canImport(UIKit)
import UIKit
import AVFoundation
import MediaPlayer

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Audio session is configured by StrataApp.onAppear once the SwiftUI
        // scene is up — that's the canonical place under the SwiftUI lifecycle.
        UIApplication.shared.beginReceivingRemoteControlEvents()
        return true
    }
}
#endif
