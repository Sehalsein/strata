import Foundation
import MediaPlayer
import StrataKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Pushes the current item into `MPNowPlayingInfoCenter` so lock screen,
/// Control Center, headphones, and CarPlay reflect what's playing.
@MainActor
public final class NowPlayingBridge {
    private let images: ImageURLBuilder
    private var artworkURL: URL?

    public init(images: ImageURLBuilder) {
        self.images = images
    }

    public func update(item: BaseItem?, position: TimeInterval, duration: TimeInterval, rate: Float) {
        guard let item else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: item.displayTitle,
            MPMediaItemPropertyAlbumTitle: item.seriesName ?? "Strata",
            MPNowPlayingInfoPropertyPlaybackRate: NSNumber(value: rate),
            MPNowPlayingInfoPropertyElapsedPlaybackTime: NSNumber(value: position)
        ]
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = NSNumber(value: duration)
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        let candidate = images.backdrop(itemId: item.id) ?? images.primary(itemId: item.id)
        if candidate != artworkURL {
            artworkURL = candidate
            if let candidate { Task { await loadArtwork(from: candidate) } }
        }
    }

    private func loadArtwork(from url: URL) async {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            #if canImport(UIKit)
            guard let image = UIImage(data: data) else { return }
            #elseif canImport(AppKit)
            guard let image = NSImage(data: data) else { return }
            #endif
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            await MainActor.run {
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        } catch {
            // best-effort
        }
    }
}
