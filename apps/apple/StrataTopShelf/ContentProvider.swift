import TVServices
import StrataKit

/// The Apple TV's Top Shelf for Strata: Continue Watching and Up Next, from the snapshot the
/// app writes when Home loads (`TopShelf`). Nothing here talks to the server. With nothing to
/// continue (or nobody signed in) it returns no content, and the system shows the app's own
/// Top Shelf image.
final class ContentProvider: TVTopShelfContentProvider {
    override func loadTopShelfContent() async -> (any TVTopShelfContent)? {
        guard let snapshot = TopShelf.load(), !snapshot.items.isEmpty else { return nil }
        let items = snapshot.items.map(Self.item)
        let section = TVTopShelfItemCollection(items: items)
        section.title = String(localized: "Continue Watching")
        return TVTopShelfSectionedContent(sections: [section])
    }

    private static func item(_ entry: TopShelfSnapshot.Item) -> TVTopShelfSectionedItem {
        let item = TVTopShelfSectionedItem(identifier: entry.id)
        item.title = [entry.title, entry.subtitle].compactMap { $0 }.joined(separator: " · ")
        item.imageShape = .hdtv
        if let url = TopShelf.image(for: entry) {
            item.setImageURL(url, for: .screenScale1x)
            item.setImageURL(url, for: .screenScale2x)
        }
        if let progress = entry.progress { item.playbackProgress = progress }
        if let url = entry.displayURL { item.displayAction = TVTopShelfAction(url: url) }
        if let url = entry.playURL { item.playAction = TVTopShelfAction(url: url) }
        return item
    }
}
