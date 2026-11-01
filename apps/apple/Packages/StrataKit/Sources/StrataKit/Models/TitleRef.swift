import Foundation

/// Which title, wherever it comes from: `<source>:<type>:<id>`, like "tmdb:show:1399" or
/// "anilist:show:154587". TMDB has movies and shows; AniList has anime TMDB may not.
/// Encodes as that one string.
public struct TitleRef: Codable, Sendable, Hashable, CustomStringConvertible {
    /// Where the id is from. One this app doesn't know is kept as sent, but isn't supported.
    public struct Source: RawRepresentable, Codable, Sendable, Hashable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let tmdb = Source(rawValue: "tmdb")
        public static let anilist = Source(rawValue: "anilist")

        /// One this app can show and play.
        public var isSupported: Bool { self == .tmdb || self == .anilist }
    }

    public var source: Source
    public var type: TitleType
    public var id: Int

    public init(source: Source, type: TitleType, id: Int) {
        self.source = source
        self.type = type
        self.id = id
    }

    /// A TMDB movie or show.
    public static func tmdb(_ type: TitleType, _ id: Int) -> TitleRef {
        TitleRef(source: .tmdb, type: type, id: id)
    }

    /// Parses `<source>:<type>:<id>`: a lowercase source, `movie` or `show`, and a positive
    /// id without leading zeros. Nil for anything else.
    public init?(string: String) {
        let parts = string.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        let source = String(parts[0]), idText = parts[2]
        guard !source.isEmpty, source.allSatisfy({ $0.isASCII && ($0.isLowercase || $0.isNumber) }),
              let type = TitleType(rawValue: String(parts[1])),
              !idText.isEmpty, idText.allSatisfy({ $0.isASCII && $0.isNumber }), idText.first != "0",
              let id = Int32(idText) else { return nil }
        self.init(source: Source(rawValue: source), type: type, id: Int(id))
    }

    public var description: String { "\(source.rawValue):\(type.rawValue):\(id)" }

    /// The TMDB id, when this is a TMDB title.
    public var tmdbId: Int? { source == .tmdb ? id : nil }

    public var isSupported: Bool { source.isSupported }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let text = try container.decode(String.self)
        guard let ref = TitleRef(string: text) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not a title ref: \(text)")
        }
        self = ref
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(description)
    }
}

// MARK: - Lists that leave out what this app can't use

/// A list item this app may not be able to use (a title from a source it doesn't know).
protocol ListItem {
    var isUsable: Bool { get }
}

/// A list from the server that drops items which don't decode or aren't usable, rather
/// than failing the whole answer. A missing list reads as empty.
@propertyWrapper
public struct LossyList<Element: Codable & Sendable & Hashable>: Codable, Sendable, Hashable {
    public var wrappedValue: [Element]

    public init(wrappedValue: [Element]) { self.wrappedValue = wrappedValue }

    public init(from decoder: Decoder) throws {
        wrappedValue = try Self.decode(from: decoder)
    }

    public func encode(to encoder: Encoder) throws {
        try wrappedValue.encode(to: encoder)
    }

    static func decode(from decoder: Decoder) throws -> [Element] {
        var container = try decoder.unkeyedContainer()
        return container.decodeLossy(Element.self)
    }
}

extension UnkeyedDecodingContainer {
    /// The items that decode and are usable; the rest are stepped past.
    mutating func decodeLossy<Element: Decodable>(_ type: Element.Type) -> [Element] {
        var items: [Element] = []
        while !isAtEnd {
            if let item = try? decode(Element.self) {
                if let listed = item as? ListItem, !listed.isUsable { continue }
                items.append(item)
            } else if (try? decode(Skip.self)) == nil {
                break
            }
        }
        return items
    }
}

/// Decodes from anything, reading nothing: steps an unkeyed container past one item.
private struct Skip: Decodable {
    init(from decoder: Decoder) {}
}

extension KeyedDecodingContainer {
    /// A missing or null list is an empty one.
    func decode<T>(_ type: LossyList<T>.Type, forKey key: Key) throws -> LossyList<T> {
        try decodeIfPresent(type, forKey: key) ?? LossyList(wrappedValue: [])
    }
}
