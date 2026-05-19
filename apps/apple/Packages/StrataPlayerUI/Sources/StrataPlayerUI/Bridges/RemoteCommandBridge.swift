import Foundation
import MediaPlayer

/// Wires `MPRemoteCommandCenter` to a `PlayerEngine`. Call `attach(_:)` once
/// at app launch; handlers run on the main actor.
@MainActor
public final class RemoteCommandBridge {
    public static let shared = RemoteCommandBridge()

    private var engine: PlayerEngine?
    private var configured = false

    private init() {}

    public func attach(_ engine: PlayerEngine) {
        self.engine = engine
        guard !configured else { return }
        configured = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            self?.engine?.play()
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.engine?.pause()
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.engine?.togglePlay()
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { await self?.engine?.skip(15) }
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { await self?.engine?.skip(-15) }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { await self?.engine?.seek(to: event.positionTime) }
            return .success
        }
    }
}
