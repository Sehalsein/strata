import SwiftUI
import AVFoundation
import AVKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Hosts Apple's standard system video player UI inside SwiftUI.
///
/// On iOS/tvOS wraps `AVPlayerViewController`; on macOS wraps `AVPlayerView`.
/// We get Apple's built-in transport controls, scrubber, AirPlay button, PiP,
/// audio/subtitle selection, and error UI for free — which also gives us
/// AVKit's diagnostic error sheet when playback fails (`Cannot Open` etc.),
/// far more useful than a black `AVPlayerLayer`.
///
/// `gravity` defaults to `.resizeAspect` (fit with letterbox/pillarbox).
/// AVPlayerViewController/AVPlayerView users can also toggle aspect fill via
/// the built-in aspect button.
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
            SystemPlayerRepresentable(player: player, gravity: gravity)
            #elseif canImport(AppKit)
            SystemPlayerRepresentableMac(player: player, gravity: gravity)
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if canImport(UIKit)
struct SystemPlayerRepresentable: UIViewControllerRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.videoGravity = gravity
        vc.allowsPictureInPicturePlayback = true
        vc.showsPlaybackControls = true
        // These AVPlayerViewController knobs don't exist on tvOS — the
        // system player there manages PiP, fullscreen, and Now Playing
        // itself, so we only set them on iOS/iPadOS.
        #if !os(tvOS)
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        vc.entersFullScreenWhenPlaybackBegins = false
        vc.exitsFullScreenWhenPlaybackEnds = false
        // We drive MPNowPlayingInfoCenter ourselves via NowPlayingBridge —
        // letting AVKit also write to it causes thrashing between the two.
        vc.updatesNowPlayingInfoCenter = false
        #endif
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player { vc.player = player }
        if vc.videoGravity != gravity { vc.videoGravity = gravity }
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

// Kept public for source-compat with `PiPController.attach(playerLayer:)`
// callers — no longer instantiated by AVPlayerContainer. AVPlayerViewController
// and AVPlayerView handle PiP internally, so callers can stop reaching for it.
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
