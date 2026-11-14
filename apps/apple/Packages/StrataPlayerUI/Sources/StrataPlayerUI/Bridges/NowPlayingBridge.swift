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
    private var artworkURL: URL?
    private var artwork: MPMediaItemArtwork?

    public init() {}

    /// `position`/`duration` are media time. Pass `meta: nil` to clear Now Playing.
    public func update(meta: PlaybackMeta?, position: TimeInterval, duration: TimeInterval, rate: Float) {
        guard let meta else {
            artworkURL = nil
            artwork = nil
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: meta.title,
            MPMediaItemPropertyAlbumTitle: meta.subtitle ?? "Strata",
            MPNowPlayingInfoPropertyPlaybackRate: NSNumber(value: rate),
            MPNowPlayingInfoPropertyElapsedPlaybackTime: NSNumber(value: position),
            MPNowPlayingInfoPropertyMediaType: NSNumber(value: MPNowPlayingInfoMediaType.video.rawValue),
        ]
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = NSNumber(value: duration)
        }
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        let candidate = meta.artworkURL
        if candidate != artworkURL {
            artwork = nil
            artworkURL = candidate
            if let candidate { Task { await loadArtwork(from: candidate) } }
        }
    }

    #if canImport(UIKit)
    private typealias PlatformImage = UIImage
    #elseif canImport(AppKit)
    private typealias PlatformImage = NSImage
    #endif

    /// Built outside the main actor: the system calls the closure on a background queue,
    /// and a main-actor closure there traps.
    nonisolated private static func artwork(_ image: PlatformImage) -> MPMediaItemArtwork {
        let box = ImageBox(image)
        return MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in box.image }
    }

    private func loadArtwork(from url: URL) async {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            #if canImport(UIKit)
            guard let image = UIImage(data: data) else { return }
            #elseif canImport(AppKit)
            guard let image = NSImage(data: data) else { return }
            #endif
            let artwork = Self.artwork(image)
            await MainActor.run {
                guard url == self.artworkURL else { return }
                self.artwork = artwork
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        } catch {
            // best-effort
        }
    }
}

/// Hands the artwork image to the closure the system calls off the main thread (it's only read).
private final class ImageBox: @unchecked Sendable {
    #if canImport(UIKit)
    let image: UIImage
    init(_ image: UIImage) { self.image = image }
    #elseif canImport(AppKit)
    let image: NSImage
    init(_ image: NSImage) { self.image = image }
    #endif
}
