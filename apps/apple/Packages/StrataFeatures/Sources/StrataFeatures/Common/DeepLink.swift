import Foundation

/// Parses incoming `strata://` URLs. Supported shapes:
/// - `strata://item/<id>` — push the detail screen for the item
/// - `strata://watch/<id>?t=<seconds>` — open the player at an optional start time
public enum DeepLink {
    public enum Destination: Equatable {
        case item(id: String)
        case watch(itemId: String, startSeconds: TimeInterval?)
    }

    public static func parse(_ url: URL) -> Destination? {
        guard url.scheme == "strata" else { return nil }
        let host = url.host ?? ""
        let pathComponents = url.pathComponents.filter { $0 != "/" }
        switch host {
        case "item":
            guard let id = pathComponents.first else { return nil }
            return .item(id: id)
        case "watch":
            guard let id = pathComponents.first else { return nil }
            let t = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "t" })?
                .value
                .flatMap(TimeInterval.init)
            return .watch(itemId: id, startSeconds: t)
        default:
            return nil
        }
    }
}
