import SwiftUI

/// Invisible view that hosts the player's keyboard shortcuts. Add to any
/// container that should respond to keypresses while playback is active.
public struct PlayerKeyCommands: View {
    @Bindable var engine: PlayerEngine
    public let onToggleCaptions: () -> Void
    public let onToggleFullscreen: () -> Void
    public let onTogglePiP: () -> Void

    public init(engine: PlayerEngine,
                onToggleCaptions: @escaping () -> Void = {},
                onToggleFullscreen: @escaping () -> Void = {},
                onTogglePiP: @escaping () -> Void = {}) {
        self.engine = engine
        self.onToggleCaptions = onToggleCaptions
        self.onToggleFullscreen = onToggleFullscreen
        self.onTogglePiP = onTogglePiP
    }

    public var body: some View {
        #if os(tvOS)
        // tvOS uses the Siri Remote / focus engine and has no keyboardShortcut.
        EmptyView()
        #else
        VStack(spacing: 0) {
            Button(" " as String) { engine.togglePlay() }
                .keyboardShortcut(.space, modifiers: [])
            Button("←" as String) { Task { await engine.skip(-5) } }
                .keyboardShortcut(.leftArrow, modifiers: [])
            Button("→" as String) { Task { await engine.skip(5) } }
                .keyboardShortcut(.rightArrow, modifiers: [])
            Button("J" as String) { Task { await engine.skip(-10) } }
                .keyboardShortcut("j", modifiers: [])
            Button("L" as String) { Task { await engine.skip(10) } }
                .keyboardShortcut("l", modifiers: [])
            Button("M" as String) { engine.toggleMute() }
                .keyboardShortcut("m", modifiers: [])
            Button("F" as String) { onToggleFullscreen() }
                .keyboardShortcut("f", modifiers: [])
            Button("C" as String) { onToggleCaptions() }
                .keyboardShortcut("c", modifiers: [])
            Button("S" as String) { engine.cycleSpeed() }
                .keyboardShortcut("s", modifiers: [])
            Button("P" as String) { onTogglePiP() }
                .keyboardShortcut("p", modifiers: [])
        }
        .frame(width: 0, height: 0)
        .opacity(0)
        .accessibilityHidden(true)
        #endif
    }
}

#if os(macOS)
/// Menu-bar commands for Mac. Mirrors the keyboard shortcuts above so they
/// appear under a "Playback" menu and document the bindings to the user.
public struct PlaybackCommands: Commands {
    let engine: PlayerEngine

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some Commands {
        CommandMenu(Text("Playback", bundle: .module)) {
            Button(String(localized: "Play / Pause", bundle: .module)) { engine.togglePlay() }
                .keyboardShortcut(.space, modifiers: [])
            Divider()
            Button(String(localized: "Skip Back 10s", bundle: .module)) { Task { await engine.skip(-10) } }
                .keyboardShortcut("j", modifiers: [])
            Button(String(localized: "Skip Forward 10s", bundle: .module)) { Task { await engine.skip(10) } }
                .keyboardShortcut("l", modifiers: [])
            Button(String(localized: "Skip Back 5s", bundle: .module)) { Task { await engine.skip(-5) } }
                .keyboardShortcut(.leftArrow, modifiers: [])
            Button(String(localized: "Skip Forward 5s", bundle: .module)) { Task { await engine.skip(5) } }
                .keyboardShortcut(.rightArrow, modifiers: [])
            Divider()
            Button(String(localized: "Mute", bundle: .module)) { engine.toggleMute() }
                .keyboardShortcut("m", modifiers: [])
            Button(String(localized: "Cycle Speed", bundle: .module)) { engine.cycleSpeed() }
                .keyboardShortcut("s", modifiers: [])
        }
    }
}
#endif
