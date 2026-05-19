import SwiftUI
import AVFoundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Hosts an `AVPlayerLayer` inside SwiftUI so the chrome can be entirely custom.
///
/// Defaults to `.resizeAspect` — fit with letterbox/pillarbox, matching
/// Apple's Photos and TV apps. Pass `.resizeAspectFill` to fill with cropping.
public struct AVPlayerContainer: View {
    public let player: AVPlayer
    public let gravity: AVLayerVideoGravity

    public init(player: AVPlayer, gravity: AVLayerVideoGravity = .resizeAspect) {
        self.player = player
        self.gravity = gravity
    }

    public var body: some View {
        Group {
            #if canImport(UIKit)
            AVPlayerContainerRepresentable(player: player, gravity: gravity)
            #elseif canImport(AppKit)
            AVPlayerContainerRepresentableMac(player: player, gravity: gravity)
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if canImport(UIKit)
struct AVPlayerContainerRepresentable: UIViewRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity

    func makeUIView(context: Context) -> PlayerLayerHostView {
        let v = PlayerLayerHostView()
        v.backgroundColor = .black
        v.layer.backgroundColor = UIColor.black.cgColor
        v.playerLayer.player = player
        v.playerLayer.videoGravity = gravity
        return v
    }

    func updateUIView(_ uiView: PlayerLayerHostView, context: Context) {
        uiView.playerLayer.player = player
        uiView.playerLayer.videoGravity = gravity
    }
}

public final class PlayerLayerHostView: UIView {
    public override class var layerClass: AnyClass { AVPlayerLayer.self }
    public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}
#endif

#if canImport(AppKit)
struct AVPlayerContainerRepresentableMac: NSViewRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity

    func makeNSView(context: Context) -> PlayerLayerHostNSView {
        let v = PlayerLayerHostNSView()
        v.wantsLayer = true
        v.layer = AVPlayerLayer()
        v.playerLayer.backgroundColor = NSColor.black.cgColor
        v.playerLayer.player = player
        v.playerLayer.videoGravity = gravity
        return v
    }

    func updateNSView(_ nsView: PlayerLayerHostNSView, context: Context) {
        nsView.playerLayer.player = player
        nsView.playerLayer.videoGravity = gravity
    }
}

public final class PlayerLayerHostNSView: NSView {
    public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    public override func makeBackingLayer() -> CALayer { AVPlayerLayer() }
}
#endif
