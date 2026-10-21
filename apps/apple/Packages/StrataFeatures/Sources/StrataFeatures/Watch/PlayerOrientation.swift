#if os(iOS)
import UIKit

/// The player opens in landscape on iPhone, and the app goes back to portrait after it.
/// iPad keeps every orientation: with multitasking, the system doesn't let an app lock it.
@MainActor
public enum PlayerOrientation {
    private static var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    /// What the app allows right now; the app delegate reports it to the system.
    public private(set) static var allowed: UIInterfaceOrientationMask = UIDevice.current.userInterfaceIdiom == .phone ? .allButUpsideDown : .all

    static func enterPlayer() { lock(.landscape, turnTo: .landscapeRight) }
    static func leavePlayer() { lock(.allButUpsideDown, turnTo: .portrait) }

    private static func lock(_ mask: UIInterfaceOrientationMask, turnTo orientation: UIInterfaceOrientationMask) {
        guard isPhone else { return }
        allowed = mask
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientation)) { _ in }
        }
    }
}
#endif
