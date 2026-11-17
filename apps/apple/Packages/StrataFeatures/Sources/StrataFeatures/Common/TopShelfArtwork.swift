#if os(tvOS)
import UIKit
import StrataKit

/// Lays each Top Shelf item's logo on its backdrop (the Top Shelf shows one image per item,
/// with nothing drawn over it), and keeps the results in the App Group for the extension.
enum TopShelfArtwork {
    /// The Top Shelf's wide cards at 2x: 1096 × 616; a little over, for 4K.
    static let size = CGSize(width: 1280, height: 720)

    /// Makes the art of every item that has a logo and none made yet, and deletes art no
    /// item uses any more. Returns the items with `artworkFile` set where there's art.
    static func make(for items: [TopShelfSnapshot.Item]) async -> [TopShelfSnapshot.Item] {
        guard let dir = TopShelf.artworkDirectory else { return items }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var out = items
        for i in out.indices {
            guard !Task.isCancelled else { return items }
            guard let name = TopShelf.artworkName(for: out[i]) else { continue }
            let file = dir.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: file.path) {
                guard let image = out[i].imageURL, let logo = out[i].logoURL,
                      let data = await render(image: image, logo: logo) else { continue }
                try? data.write(to: file, options: .atomic)
            }
            out[i].artworkFile = name
        }
        // Art for titles that left the shelf.
        let used = Set(out.compactMap(\.artworkFile))
        for file in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where !used.contains(file.lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
        }
        return out
    }

    /// The backdrop filling the card, darkened toward the bottom left, with the logo there:
    /// above the bottom edge, where the Top Shelf draws its progress bar.
    private static func render(image imageURL: URL, logo logoURL: URL) async -> Data? {
        async let imageData = data(imageURL)
        async let logoData = data(logoURL)
        guard let backdrop = await imageData.flatMap(UIImage.init(data:)),
              let logo = await logoData.flatMap(UIImage.init(data:)) else { return nil }
        let size = Self.size
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            // Backdrop: aspect fill.
            let scale = max(size.width / backdrop.size.width, size.height / backdrop.size.height)
            let drawn = CGSize(width: backdrop.size.width * scale, height: backdrop.size.height * scale)
            backdrop.draw(in: CGRect(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2, width: drawn.width, height: drawn.height))
            // Shade so a light logo reads on a light backdrop.
            let colors = [UIColor.black.withAlphaComponent(0.7).cgColor, UIColor.black.withAlphaComponent(0).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: CGPoint(x: 0, y: size.height), end: CGPoint(x: size.width * 0.55, y: size.height * 0.35), options: [])
            }
            // Logo: within 42% of the width and 26% of the height, bottom left.
            let box = CGSize(width: size.width * 0.42, height: size.height * 0.26)
            let fit = min(box.width / logo.size.width, box.height / logo.size.height)
            let logoSize = CGSize(width: logo.size.width * fit, height: logo.size.height * fit)
            let origin = CGPoint(x: size.width * 0.06, y: size.height * 0.84 - logoSize.height)
            cg.setShadow(offset: .zero, blur: 18, color: UIColor.black.withAlphaComponent(0.5).cgColor)
            logo.draw(in: CGRect(origin: origin, size: logoSize))
        }
        return rendered.jpegData(compressionQuality: 0.85)
    }

    private static func data(_ url: URL) async -> Data? {
        guard let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { return nil }
        return data
    }
}
#endif
