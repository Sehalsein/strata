import Foundation
import AVKit
import Observation
import StrataKit

@MainActor
@Observable
public final class PiPController: NSObject, AVPictureInPictureControllerDelegate {
    public private(set) var isAvailable: Bool = false
    public private(set) var isActive: Bool = false

    private var controller: AVPictureInPictureController?
    /// Told when the window opens and closes (the engine keeps the video running behind it).
    public var onActiveChange: ((Bool) -> Void)?

    public override init() {
        super.init()
    }

    /// Wire the controller to an `AVPlayerLayer`. Call once the player layer
    /// is hosted on screen.
    public func attach(playerLayer: AVPlayerLayer) {
        // The same layer as last time: its controller still works.
        guard controller?.playerLayer !== playerLayer else { return }
        isAvailable = AVPictureInPictureController.isPictureInPictureSupported()
        // The iPhone simulator reports no PiP support, so the button is hidden there.
        Log.player.debug("pip attach supported=\(self.isAvailable, privacy: .public)")
        guard isAvailable else { return }
        let c = AVPictureInPictureController(playerLayer: playerLayer)
        c?.delegate = self
        #if os(iOS)
        // Leaving the app mid-playback continues in Picture in Picture.
        c?.canStartPictureInPictureAutomaticallyFromInline = true
        #endif
        self.controller = c
    }

    public func toggle() {
        guard let controller else { return }
        if controller.isPictureInPictureActive {
            controller.stopPictureInPicture()
        } else {
            controller.startPictureInPicture()
        }
    }

    nonisolated public func pictureInPictureControllerWillStartPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.onActiveChange?(true) }
    }

    nonisolated public func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.isActive = true }
    }

    nonisolated public func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in
            self.isActive = false
            self.onActiveChange?(false)
        }
    }
}
