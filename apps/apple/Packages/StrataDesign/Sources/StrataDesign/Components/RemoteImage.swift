import SwiftUI
#if canImport(UIKit)
import ImageIO
import UIKit

/// Decoded artwork, shrunk to the size it's shown at, kept in memory. `AsyncImage`
/// only has URLCache's compressed bytes, so a rail scrolled back and forth re-decoded
/// full-size images on the main thread and flashed placeholders.
@MainActor
final class ImagePipeline {
    static let shared = ImagePipeline()

    private let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 160 * 1024 * 1024
        return cache
    }()

    /// One download and decode per key, shared by everyone showing it.
    @MainActor private final class Load {
        let key: NSString
        let task: Task<UIImage?, Never>
        /// Views still waiting on it; at zero it's cancelled (scrolled past before it came).
        var waiters = 0
        init(_ key: NSString, _ task: Task<UIImage?, Never>) {
            self.key = key
            self.task = task
        }
    }
    private var loading: [NSString: Load] = [:]

    func cached(_ url: URL, maxPixel: Int) -> UIImage? {
        cache.object(forKey: Self.key(url, maxPixel))
    }

    /// Cards load at `.utility`, so a hero and the player's art go first.
    func image(_ url: URL, maxPixel: Int, priority: TaskPriority = .utility) async -> UIImage? {
        let key = Self.key(url, maxPixel)
        if let hit = cache.object(forKey: key) { return hit }
        let load = loading[key] ?? start(url, maxPixel: maxPixel, key: key, priority: priority)
        load.waiters += 1
        let image = await withTaskCancellationHandler {
            await load.task.value
        } onCancel: {
            Task { @MainActor in self.leave(load) }
        }
        if !Task.isCancelled { leave(load) }
        return image
    }

    /// Starts a load nobody is showing yet, for art that's about to be (the hero's next title).
    func prefetch(_ url: URL, maxPixel: Int) {
        let key = Self.key(url, maxPixel)
        guard cache.object(forKey: key) == nil, loading[key] == nil else { return }
        // Held as a waiter until it's done, so a view that comes and goes doesn't cancel it.
        let load = start(url, maxPixel: maxPixel, key: key, priority: .utility)
        load.waiters += 1
        Task { _ = await load.task.value; leave(load) }
    }

    private func start(_ url: URL, maxPixel: Int, key: NSString, priority: TaskPriority) -> Load {
        let task = Task<UIImage?, Never>.detached(priority: priority) {
            // URLSession.shared goes through URLCache, so bytes survive relaunches.
            guard let (data, _) = try? await URLSession.shared.data(from: url), !Task.isCancelled else { return nil }
            return Self.downsample(data, maxPixel: maxPixel)
        }
        let load = Load(key, task)
        loading[key] = load
        Task {
            let image = await task.value
            if loading[key] === load { loading[key] = nil }
            guard let image else { return }
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            cache.setObject(image, forKey: key, cost: cost)
        }
        return load
    }

    private func leave(_ load: Load) {
        load.waiters -= 1
        guard load.waiters <= 0 else { return }
        // Nobody is showing it any more: stop the download (a finished one is cached anyway).
        load.task.cancel()
        if loading[load.key] === load { loading[load.key] = nil }
    }

    private static func key(_ url: URL, _ maxPixel: Int) -> NSString {
        "\(maxPixel)|\(url.absoluteString)" as NSString
    }

    /// Decodes straight to a thumbnail no bigger than `maxPixel` on its long side.
    nonisolated private static func downsample(_ data: Data, maxPixel: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

/// A remote image filling its frame, from `ImagePipeline`: a cached image shows at
/// once with no fade; a new one fades in over the placeholder.
public struct RemoteImage<Placeholder: View>: View {
    let url: URL?
    let maxPixel: Int
    let blur: CGFloat
    let priority: TaskPriority
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var loaded: (url: URL, image: UIImage)?

    /// `priority`: `.utility` for cards and thumbnails; `.userInitiated` for the art a
    /// screen is about (a hero, the player's backdrop).
    public init(url: URL?, maxPixel: Int, blur: CGFloat = 0, priority: TaskPriority = .utility, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.maxPixel = maxPixel
        self.blur = blur
        self.priority = priority
        self.placeholder = placeholder
    }

    /// Starts loading an image a `RemoteImage` will show soon, at the same size.
    public static func prefetch(_ url: URL, maxPixel: Int) {
        ImagePipeline.shared.prefetch(url, maxPixel: maxPixel)
    }

    public var body: some View {
        // Prefer the state for this URL, else a cache hit (no flash on scroll-back).
        let image = url.flatMap { url in loaded?.url == url ? loaded?.image : ImagePipeline.shared.cached(url, maxPixel: maxPixel) }
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill().blur(radius: blur, opaque: blur > 0)
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            // Cancelled when the view goes, which lets go of the shared load.
            guard let url, ImagePipeline.shared.cached(url, maxPixel: maxPixel) == nil else { return }
            guard let image = await ImagePipeline.shared.image(url, maxPixel: maxPixel, priority: priority), !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { loaded = (url, image) }
        }
    }
}
#else
/// Elsewhere (macOS builds of the package): plain AsyncImage.
public struct RemoteImage<Placeholder: View>: View {
    let url: URL?
    let blur: CGFloat
    @ViewBuilder let placeholder: () -> Placeholder

    public init(url: URL?, maxPixel: Int, blur: CGFloat = 0, priority: TaskPriority = .utility, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.blur = blur
        self.placeholder = placeholder
    }

    public static func prefetch(_ url: URL, maxPixel: Int) {}

    public var body: some View {
        AsyncImage(url: url) { phase in
            if case .success(let image) = phase {
                image.resizable().scaledToFill().blur(radius: blur, opaque: blur > 0)
            } else {
                placeholder()
            }
        }
    }
}
#endif
