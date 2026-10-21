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
    private var loading: [NSString: Task<UIImage?, Never>] = [:]

    func cached(_ url: URL, maxPixel: Int) -> UIImage? {
        cache.object(forKey: Self.key(url, maxPixel))
    }

    func image(_ url: URL, maxPixel: Int) async -> UIImage? {
        let key = Self.key(url, maxPixel)
        if let hit = cache.object(forKey: key) { return hit }
        if let running = loading[key] { return await running.value }
        let task = Task<UIImage?, Never>.detached(priority: .userInitiated) {
            // URLSession.shared goes through URLCache, so bytes survive relaunches.
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
            return Self.downsample(data, maxPixel: maxPixel)
        }
        loading[key] = task
        let image = await task.value
        loading[key] = nil
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            cache.setObject(image, forKey: key, cost: cost)
        }
        return image
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
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var loaded: (url: URL, image: UIImage)?

    public init(url: URL?, maxPixel: Int, blur: CGFloat = 0, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.maxPixel = maxPixel
        self.blur = blur
        self.placeholder = placeholder
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
            guard let url, ImagePipeline.shared.cached(url, maxPixel: maxPixel) == nil else { return }
            guard let image = await ImagePipeline.shared.image(url, maxPixel: maxPixel), !Task.isCancelled else { return }
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

    public init(url: URL?, maxPixel: Int, blur: CGFloat = 0, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.blur = blur
        self.placeholder = placeholder
    }

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
