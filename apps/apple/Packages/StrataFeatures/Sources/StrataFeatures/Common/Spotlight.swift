import Foundation
import UniformTypeIdentifiers
import StrataKit
#if canImport(CoreSpotlight) && !os(tvOS)
import CoreSpotlight
#endif

/// Publishes a library snapshot into Spotlight so the user can launch a
/// title from system search. Re-indexes on every library refresh.
/// No-op on tvOS — Apple TV doesn't surface CoreSpotlight.
public enum Spotlight {
    public static func index(items: [BaseItem], images: ImageURLBuilder?) {
        #if canImport(CoreSpotlight) && !os(tvOS)
        let entries: [CSSearchableItem] = items.compactMap { item in
            let attrs = CSSearchableItemAttributeSet(itemContentType: UTType.movie.identifier)
            attrs.title = item.displayTitle
            attrs.contentDescription = item.overviewText
            attrs.genre = item.genres?.joined(separator: ", ")
            if let year = item.productionYear { attrs.contentCreationDate = makeDate(year: year) }
            if let url = images?.primary(itemId: item.id) {
                attrs.thumbnailURL = url
            }
            return CSSearchableItem(
                uniqueIdentifier: "strata.item.\(item.id)",
                domainIdentifier: "strata.library",
                attributeSet: attrs
            )
        }
        guard !entries.isEmpty else { return }
        CSSearchableIndex.default().indexSearchableItems(entries) { _ in }
        #endif
    }

    public static func clear() {
        #if canImport(CoreSpotlight) && !os(tvOS)
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: ["strata.library"]) { _ in }
        #endif
    }

    /// Extracts the item id from a Spotlight selection's `uniqueIdentifier`.
    public static func itemId(from spotlightIdentifier: String) -> String? {
        let prefix = "strata.item."
        guard spotlightIdentifier.hasPrefix(prefix) else { return nil }
        return String(spotlightIdentifier.dropFirst(prefix.count))
    }

    #if canImport(CoreSpotlight) && !os(tvOS)
    private static func makeDate(year: Int) -> Date? {
        var comp = DateComponents()
        comp.year = year
        comp.month = 1
        comp.day = 1
        return Calendar(identifier: .gregorian).date(from: comp)
    }
    #endif
}
