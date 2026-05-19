import SwiftUI
import StrataDesign
import StrataKit

public struct AudioMenu: View {
    @Bindable var engine: PlayerEngine
    @State private var showSheet = false

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some View {
        #if os(tvOS)
        ControlButton(systemImage: "speaker.wave.2") { showSheet = true }
            .disabled(engine.audioTracks.count < 2)
            .sheet(isPresented: $showSheet) {
                TrackPickerSheet(
                    title: "Audio",
                    tracks: engine.audioTracks,
                    selectedIndex: engine.activeAudioIndex,
                    allowOff: false,
                    onSelect: { stream in
                        Task { await engine.selectAudio(stream) }
                        showSheet = false
                    },
                    onSelectOff: { showSheet = false },
                    onCancel: { showSheet = false }
                )
            }
        #else
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
        #endif
    }
}

public struct SubtitleMenu: View {
    @Bindable var engine: PlayerEngine
    @State private var showSheet = false

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some View {
        #if os(tvOS)
        ControlButton(systemImage: engine.captionsEnabled ? "captions.bubble.fill" : "captions.bubble") {
            showSheet = true
        }
        .disabled(engine.subtitleTracks.isEmpty)
        .sheet(isPresented: $showSheet) {
            TrackPickerSheet(
                title: "Subtitles",
                tracks: engine.subtitleTracks,
                selectedIndex: engine.activeSubtitleIndex,
                allowOff: true,
                onSelect: { stream in
                    Task { await engine.selectSubtitle(stream) }
                    showSheet = false
                },
                onSelectOff: {
                    Task { await engine.selectSubtitle(nil) }
                    showSheet = false
                },
                onCancel: { showSheet = false }
            )
        }
        #else
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
        #endif
    }
}

public struct SpeedMenu: View {
    @Bindable var engine: PlayerEngine
    @State private var showSheet = false
    private let options: [Float] = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some View {
        #if os(tvOS)
        Button {
            showSheet = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "speedometer")
                    .font(.system(size: 22, weight: .semibold))
                Text(String(format: "%.2g×", engine.rate))
                    .font(.mono(16, weight: .semibold))
            }
            .frame(height: 78)
            .padding(.horizontal, 20)
        }
        .buttonStyle(StrataTransportButtonStyle())
        .sheet(isPresented: $showSheet) {
            SpeedPickerSheet(
                current: engine.rate,
                options: options,
                onSelect: { rate in
                    engine.rate = rate
                    showSheet = false
                },
                onCancel: { showSheet = false }
            )
        }
        #else
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
        #endif
    }
}

#if os(tvOS)
private struct TrackPickerSheet: View {
    let title: String
    let tracks: [MediaStream]
    let selectedIndex: Int?
    let allowOff: Bool
    let onSelect: (MediaStream) -> Void
    let onSelectOff: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Strata.Tokens.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 32) {
                Text(title.uppercased())
                    .font(.mono(20, weight: .semibold))
                    .tracking(3.6)
                    .foregroundStyle(Strata.Tokens.paper)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if allowOff {
                            TrackPickerRow(
                                label: "Off",
                                detail: nil,
                                isSelected: selectedIndex == nil,
                                action: onSelectOff
                            )
                        }
                        ForEach(tracks, id: \.index) { stream in
                            TrackPickerRow(
                                label: stream.displayTitle ?? stream.title ?? stream.language ?? "Track \(stream.index)",
                                detail: stream.codec?.uppercased(),
                                isSelected: selectedIndex == stream.index,
                                action: { onSelect(stream) }
                            )
                        }
                    }
                    .padding(.vertical, 12)
                }
            }
            .padding(80)
            .frame(maxWidth: 900, alignment: .leading)
        }
    }
}

private struct SpeedPickerSheet: View {
    let current: Float
    let options: [Float]
    let onSelect: (Float) -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Strata.Tokens.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 32) {
                Text("PLAYBACK SPEED")
                    .font(.mono(20, weight: .semibold))
                    .tracking(3.6)
                    .foregroundStyle(Strata.Tokens.paper)
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(options, id: \.self) { rate in
                        TrackPickerRow(
                            label: rate == 1.0 ? "Normal" : String(format: "%.2g×", rate),
                            detail: nil,
                            isSelected: abs(current - rate) < 0.01,
                            action: { onSelect(rate) }
                        )
                    }
                }
            }
            .padding(80)
            .frame(maxWidth: 720, alignment: .leading)
        }
    }
}

private struct TrackPickerRow: View {
    let label: String
    let detail: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 18) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(isSelected ? Strata.Tokens.accent : Strata.Tokens.paper.opacity(0.4))
                Text(label)
                    .font(.fraunces(24, opticalSize: 60, soft: 50))
                    .foregroundStyle(Strata.Tokens.paper)
                Spacer()
                if let detail {
                    Text(detail)
                        .font(.mono(13))
                        .tracking(1.5)
                        .foregroundStyle(Strata.Tokens.paperDim)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(StrataSecondaryButtonStyle())
    }
}
#endif
