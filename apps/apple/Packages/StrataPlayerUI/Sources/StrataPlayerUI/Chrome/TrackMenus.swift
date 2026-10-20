import SwiftUI
import StrataDesign
import StrataKit

/// A round glass icon button for player controls.
public struct PlayerIconButton: View {
    let systemImage: String
    let label: String
    let size: Size
    let action: () -> Void

    public enum Size { case regular, large }

    public init(_ label: String, systemImage: String, size: Size = .regular, action: @escaping () -> Void) {
        self.label = label
        self.systemImage = systemImage
        self.size = size
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            PlayerIcon(systemImage: systemImage, size: size)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel(label)
    }
}

struct PlayerIcon: View {
    let systemImage: String
    let size: PlayerIconButton.Size

    var body: some View {
        #if os(tvOS)
        let font: Font = size == .large ? .title : .title3
        let side: CGFloat = size == .large ? 72 : 52
        #else
        let font: Font = size == .large ? .title.weight(.semibold) : .body.weight(.semibold)
        let side: CGFloat = size == .large ? 52 : 30
        #endif
        Image(systemName: systemImage)
            .font(font)
            .frame(width: side, height: side)
            .contentTransition(.symbolEffect(.replace))
    }
}

/// Audio track picker. Switching re-plans the stream at the current position.
public struct AudioMenu: View {
    @Bindable var engine: PlayerEngine
    public init(engine: PlayerEngine) { self.engine = engine }

    public var body: some View {
        Menu {
            Picker("Audio", selection: Binding(
                get: { engine.activeAudioIndex ?? -1 },
                set: { index in
                    if let track = engine.audioTracks.first(where: { $0.index == index }) {
                        Task { await engine.selectAudio(track) }
                    }
                }
            )) {
                ForEach(engine.audioTracks) { track in
                    Text(track.displayTitle).tag(track.index)
                }
            }
            .pickerStyle(.inline)
        } label: {
            PlayerIcon(systemImage: "waveform", size: .regular)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .disabled(engine.audioTracks.count < 2)
        .accessibilityLabel("Audio")
    }
}

/// Subtitle picker: Off plus every text track the server can convert.
public struct SubtitleMenu: View {
    @Bindable var engine: PlayerEngine
    public init(engine: PlayerEngine) { self.engine = engine }

    public var body: some View {
        Menu {
            Picker("Subtitles", selection: Binding(
                get: { engine.activeSubtitleId ?? "" },
                set: { id in
                    let track = engine.subtitleTracks.first { $0.id == id }
                    Task { await engine.selectSubtitle(track) }
                }
            )) {
                Text("Off").tag("")
                ForEach(engine.subtitleTracks.filter(\.isTextBased)) { track in
                    Text(track.displayTitle).tag(track.id)
                }
            }
            .pickerStyle(.inline)
            if engine.subtitleTracks.contains(where: { !$0.isTextBased }) {
                Text("Some subtitle tracks are images and can't be shown yet.")
            }
        } label: {
            PlayerIcon(systemImage: engine.captionsEnabled ? "captions.bubble.fill" : "captions.bubble", size: .regular)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .disabled(engine.subtitleTracks.isEmpty)
        .accessibilityLabel("Subtitles")
    }
}

/// Playback speed picker.
public struct SpeedMenu: View {
    @Bindable var engine: PlayerEngine
    public init(engine: PlayerEngine) { self.engine = engine }

    private static let rates: [Float] = [0.75, 1.0, 1.25, 1.5, 2.0]

    public var body: some View {
        Menu {
            Picker("Speed", selection: $engine.rate) {
                ForEach(Self.rates, id: \.self) { rate in
                    Text(rate == 1 ? "Normal" : String(format: "%g×", rate)).tag(rate)
                }
            }
            .pickerStyle(.inline)
            Picker("Sleep timer", selection: Binding(
                get: { PlayerEngine.SleepOption.off },
                set: { engine.setSleepTimer($0) }
            )) {
                ForEach(PlayerEngine.SleepOption.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.menu)
        } label: {
            PlayerIcon(systemImage: "gauge.with.dots.needle.67percent", size: .regular)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel("Speed")
    }
}
