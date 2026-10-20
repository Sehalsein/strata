import SwiftUI
import AVFoundation
import AVKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// The video surface: a bare `AVPlayerLayer`, no system controls. Strata draws
/// its own Liquid Glass chrome on top (it seeks past the stream's produced range,
/// which the system scrubber can't). `onLayer` hands the layer out for Picture in
/// Picture once it's on screen.
public struct AVPlayerContainer: View {
    public let player: AVPlayer
    public let gravity: AVLayerVideoGravity
    let onLayer: ((AVPlayerLayer) -> Void)?

    public init(player: AVPlayer, gravity: AVLayerVideoGravity = .resizeAspect, onLayer: ((AVPlayerLayer) -> Void)? = nil) {
        self.player = player
        self.gravity = gravity
        self.onLayer = onLayer
    }

    public var body: some View {
        Group {
            #if canImport(UIKit)
            PlayerLayerRepresentable(player: player, gravity: gravity, onLayer: onLayer)
            #elseif canImport(AppKit)
            SystemPlayerRepresentableMac(player: player, gravity: gravity)
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if canImport(UIKit)
struct PlayerLayerRepresentable: UIViewRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity
    let onLayer: ((AVPlayerLayer) -> Void)?

    func makeUIView(context: Context) -> PlayerLayerHostView {
        let view = PlayerLayerHostView()
        view.backgroundColor = .black
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        if let onLayer { DispatchQueue.main.async { onLayer(view.playerLayer) } }
        return view
    }

    func updateUIView(_ view: PlayerLayerHostView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
        if view.playerLayer.videoGravity != gravity { view.playerLayer.videoGravity = gravity }
    }
}
#endif

#if canImport(AppKit)
struct SystemPlayerRepresentableMac: NSViewRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity

    func makeNSView(context: Context) -> AVPlayerView {
        let v = AVPlayerView()
        v.player = player
        v.videoGravity = gravity
        v.allowsPictureInPicturePlayback = true
        v.controlsStyle = .floating
        return v
    }

    func updateNSView(_ v: AVPlayerView, context: Context) {
        if v.player !== player { v.player = player }
        if v.videoGravity != gravity { v.videoGravity = gravity }
    }
}
#endif

#if canImport(UIKit)
public final class PlayerLayerHostView: UIView {
    public override class var layerClass: AnyClass { AVPlayerLayer.self }
    public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}
#endif

#if canImport(AppKit)
public final class PlayerLayerHostNSView: NSView {
    public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    public override func makeBackingLayer() -> CALayer { AVPlayerLayer() }
}
#endif
