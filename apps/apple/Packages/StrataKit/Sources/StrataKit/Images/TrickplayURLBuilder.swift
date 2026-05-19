import Foundation

public extension ImageURLBuilder {
    /// Sprite-sheet image URL — `/Videos/{itemId}/Trickplay/{width}/{tileIndex}.jpg`.
    /// `tileIndex` is the zero-based sheet index (each sheet contains `tileWidth × tileHeight` frames).
    func trickplaySheet(itemId: String, width: Int, sheetIndex: Int) -> URL? {
        guard var comps = URLComponents(
            url: serverURL.appendingPathComponent("/Videos/\(itemId)/Trickplay/\(width)/\(sheetIndex).jpg"),
            resolvingAgainstBaseURL: false
        ) else { return nil }
        if let token, !token.isEmpty {
            comps.queryItems = [.init(name: "api_key", value: token)]
        }
        return comps.url
    }
}
