import SwiftUI
import StrataDesign
import StrataKit
import StrataPlayerUI
import StrataFeatures
#if canImport(UIKit)
import UIKit
import AVFoundation
#endif

@main
struct StrataApp: App {
    #if canImport(UIKit)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    @State private var services = AppServices(auth: AuthStore())

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(services)
                .onAppear { configureAudioSession() }
                .onOpenURL { url in services.coordinator.handle(url: url) }
        }
        #if os(macOS)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(after: .toolbar) {
                Button("Sign Out") {
                    services.auth.signOut()
                    services.refreshSessionDependentServices()
                }
                .keyboardShortcut("L", modifiers: [.command, .shift])
            }
            PlaybackCommands(engine: services.engine)
        }
        #endif

        #if os(macOS)
        MenuBarScene(services: services)
        #endif
    }

    private func configureAudioSession() {
        #if canImport(UIKit) && !targetEnvironment(macCatalyst)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // best-effort
        }
        #endif
    }
}
