import Foundation
import AVKit
import Observation

@MainActor
@Observable
public final class PiPController: NSObject, AVPictureInPictureControllerDelegate {
    public private(set) var isAvailable: Bool = false
    public private(set) var isActive: Bool = false

    private var controller: AVPictureInPictureController?

    public override init() {
        super.init()
    }

    /// Wire the controller to an `AVPlayerLayer`. Call once the player layer
    /// is hosted on screen.
    public func attach(playerLayer: AVPlayerLayer) {
        isAvailable = AVPictureInPictureController.isPictureInPictureSupported()
        guard isAvailable else { return }
        let c = AVPictureInPictureController(playerLayer: playerLayer)
        c?.delegate = self
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

    nonisolated public func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.isActive = true }
    }

    nonisolated public func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.isActive = false }
    }
}
