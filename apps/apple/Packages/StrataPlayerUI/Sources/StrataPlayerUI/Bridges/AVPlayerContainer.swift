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
    #if os(tvOS)
    /// The display mode to ask the TV for while this view is on screen.
    var displayCriteria: AVDisplayCriteria?
    #endif

    public init(player: AVPlayer, gravity: AVLayerVideoGravity = .resizeAspect, onLayer: ((AVPlayerLayer) -> Void)? = nil) {
        self.player = player
        self.gravity = gravity
        self.onLayer = onLayer
    }

    #if os(tvOS)
    /// Asks the TV to match the video's frame rate and dynamic range while this shows.
    public func matchingDisplay(_ criteria: AVDisplayCriteria?) -> AVPlayerContainer {
        var copy = self
        copy.displayCriteria = criteria
        return copy
    }
    #endif

    public var body: some View {
        Group {
            #if canImport(UIKit)
            #if os(tvOS)
            PlayerLayerRepresentable(player: player, gravity: gravity, onLayer: onLayer, displayCriteria: displayCriteria)
            #else
            PlayerLayerRepresentable(player: player, gravity: gravity, onLayer: onLayer)
            #endif
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
    #if os(tvOS)
    var displayCriteria: AVDisplayCriteria? = nil
    #endif

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
        #if os(tvOS)
        view.displayCriteria = displayCriteria
        #endif
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

    #if os(tvOS)
    /// Set on the window's display manager while the view is in a window, and cleared
    /// when it leaves (the TV goes back to its usual mode).
    var displayCriteria: AVDisplayCriteria? {
        didSet {
            guard displayCriteria != oldValue else { return }
            window?.avDisplayManager.preferredDisplayCriteria = displayCriteria
        }
    }

    public override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        if newWindow == nil { window?.avDisplayManager.preferredDisplayCriteria = nil }
    }

    public override func didMoveToWindow() {
        super.didMoveToWindow()
        if let window, displayCriteria != nil { window.avDisplayManager.preferredDisplayCriteria = displayCriteria }
    }
    #endif
}
#endif

#if canImport(AppKit)
public final class PlayerLayerHostNSView: NSView {
    public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    public override func makeBackingLayer() -> CALayer { AVPlayerLayer() }
}
#endif
