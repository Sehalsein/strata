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
            Button(" ") { engine.togglePlay() }
                .keyboardShortcut(.space, modifiers: [])
            Button("←") { Task { await engine.skip(-5) } }
                .keyboardShortcut(.leftArrow, modifiers: [])
            Button("→") { Task { await engine.skip(5) } }
                .keyboardShortcut(.rightArrow, modifiers: [])
            Button("J") { Task { await engine.skip(-10) } }
                .keyboardShortcut("j", modifiers: [])
            Button("L") { Task { await engine.skip(10) } }
                .keyboardShortcut("l", modifiers: [])
            Button("M") { engine.toggleMute() }
                .keyboardShortcut("m", modifiers: [])
            Button("F") { onToggleFullscreen() }
                .keyboardShortcut("f", modifiers: [])
            Button("C") { onToggleCaptions() }
                .keyboardShortcut("c", modifiers: [])
            Button("S") { engine.cycleSpeed() }
                .keyboardShortcut("s", modifiers: [])
            Button("P") { onTogglePiP() }
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
        CommandMenu("Playback") {
            Button("Play / Pause") { engine.togglePlay() }
                .keyboardShortcut(.space, modifiers: [])
            Divider()
            Button("Skip Back 10s") { Task { await engine.skip(-10) } }
                .keyboardShortcut("j", modifiers: [])
            Button("Skip Forward 10s") { Task { await engine.skip(10) } }
                .keyboardShortcut("l", modifiers: [])
            Button("Skip Back 5s") { Task { await engine.skip(-5) } }
                .keyboardShortcut(.leftArrow, modifiers: [])
            Button("Skip Forward 5s") { Task { await engine.skip(5) } }
                .keyboardShortcut(.rightArrow, modifiers: [])
            Divider()
            Button("Mute") { engine.toggleMute() }
                .keyboardShortcut("m", modifiers: [])
            Button("Cycle Speed") { engine.cycleSpeed() }
                .keyboardShortcut("s", modifiers: [])
        }
    }
}
#endif
