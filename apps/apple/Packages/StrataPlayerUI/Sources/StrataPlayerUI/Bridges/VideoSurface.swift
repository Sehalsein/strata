import SwiftUI
import AVFoundation
import AetherEngine

/// The video, as AetherEngine draws it: no system controls (Strata draws its own Liquid
/// Glass chrome on top). On Apple TV the engine also asks the TV to match the video's frame
/// rate and dynamic range. `onLayer` hands the video layer out for Picture in Picture each
/// time a stream starts on the native route.
public struct VideoSurface: View {
    let engine: PlayerEngine
    let onLayer: ((AVPlayerLayer) -> Void)?

    public init(engine: PlayerEngine, onLayer: ((AVPlayerLayer) -> Void)? = nil) {
        self.engine = engine
        self.onLayer = onLayer
    }

    public var body: some View {
        AetherPlayerSurface(engine: engine.aether)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onChange(of: engine.status) { _, status in
                guard status == .playing || status == .paused, let layer = engine.nativePlayerLayer else { return }
                onLayer?(layer)
            }
    }
}
