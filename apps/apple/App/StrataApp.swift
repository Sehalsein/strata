import SwiftUI
import AVFoundation
import StrataFeatures

@main
struct StrataApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var services = AppServices()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(services)
                .onAppear { configureAudioSession() }
                .onOpenURL { url in services.coordinator.handle(url: url) }
                // A server's `/link?user_code=…` page (a TV's QR code) handed to the app, for
                // servers set up with associated domains.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { services.coordinator.handle(url: url) }
                }
                #if DEBUG
                // `-StrataOpenURL strata://…` opens a link at launch (simulator testing).
                .task {
                    if let link = UserDefaults.standard.string(forKey: "StrataOpenURL"), let url = URL(string: link) {
                        try? await Task.sleep(for: .seconds(2))
                        services.coordinator.handle(url: url)
                    }
                }
                #endif
        }
    }

    /// Only the category here: the player activates the session when playback starts (and
    /// gives it back when it stops), so opening the app doesn't stop music that's playing.
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [])
        } catch {
            // Playback still works; only background audio / silent-switch behaviour degrades.
        }
    }
}
