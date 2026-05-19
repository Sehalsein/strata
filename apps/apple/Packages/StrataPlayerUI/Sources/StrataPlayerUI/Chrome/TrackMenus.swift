import SwiftUI
import StrataDesign
import StrataKit

public struct AudioMenu: View {
    @Bindable var engine: PlayerEngine

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some View {
        Menu {
            ForEach(engine.audioTracks, id: \.index) { stream in
                Button {
                    Task { await engine.selectAudio(stream) }
                } label: {
                    HStack {
                        Text(stream.displayTitle ?? stream.title ?? stream.language ?? "Track \(stream.index)")
                        if engine.activeAudioIndex == stream.index { Image(systemName: "checkmark") }
                    }
                }
            }
        } label: {
            ControlButton(systemImage: "speaker.wave.2") {}
                .allowsHitTesting(false)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .disabled(engine.audioTracks.count < 2)
    }
}

public struct SubtitleMenu: View {
    @Bindable var engine: PlayerEngine

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some View {
        Menu {
            Button {
                Task { await engine.selectSubtitle(nil) }
            } label: {
                HStack {
                    Text("Off")
                    if engine.activeSubtitleIndex == nil { Image(systemName: "checkmark") }
                }
            }
            Divider()
            ForEach(engine.subtitleTracks, id: \.index) { stream in
                Button {
                    Task { await engine.selectSubtitle(stream) }
                } label: {
                    HStack {
                        Text(stream.displayTitle ?? stream.title ?? stream.language ?? "Track \(stream.index)")
                        if engine.activeSubtitleIndex == stream.index { Image(systemName: "checkmark") }
                    }
                }
            }
        } label: {
            ControlButton(systemImage: engine.captionsEnabled ? "captions.bubble.fill" : "captions.bubble") {}
                .allowsHitTesting(false)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .disabled(engine.subtitleTracks.isEmpty)
    }
}

public struct SpeedMenu: View {
    @Bindable var engine: PlayerEngine
    private let options: [Float] = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some View {
        Menu {
            ForEach(options, id: \.self) { rate in
                Button {
                    engine.rate = rate
                } label: {
                    HStack {
                        Text(String(format: rate == 1.0 ? "Normal" : "%.2g×", rate))
                        if engine.rate == rate { Image(systemName: "checkmark") }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "speedometer")
                Text(String(format: "%.2g×", engine.rate))
                    .font(.mono(11))
            }
            .foregroundStyle(Strata.Tokens.paper)
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(Strata.Tokens.paper.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
    }
}
