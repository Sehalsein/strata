import Foundation

public struct ImageURLBuilder: Sendable {
    public let serverURL: URL
    public let token: String?

    public init(serverURL: URL, token: String?) {
        self.serverURL = serverURL
        self.token = token
    }

    public init(session: Session) {
        self.init(serverURL: session.serverURL, token: session.token)
    }

    public func primary(itemId: String, maxWidth: Int? = 720) -> URL? {
        image(itemId: itemId, type: "Primary", maxWidth: maxWidth)
    }

    public func backdrop(itemId: String, maxWidth: Int? = 1920) -> URL? {
        image(itemId: itemId, type: "Backdrop", maxWidth: maxWidth)
    }

    public func thumb(itemId: String, maxWidth: Int? = 640) -> URL? {
        image(itemId: itemId, type: "Thumb", maxWidth: maxWidth)
    }

    // Jellyfin stores the episode still frame under the `Primary` image tag.
    // `Thumb` is rarely populated for episodes — checking imageTags lets us skip
    // the request entirely when neither exists.
    public func episodeStill(itemId: String, imageTags: [String: String]?, maxWidth: Int? = 640) -> URL? {
        let tags = imageTags ?? [:]
        if tags["Primary"] != nil { return primary(itemId: itemId, maxWidth: maxWidth) }
        if tags["Thumb"] != nil   { return thumb(itemId: itemId, maxWidth: maxWidth) }
        return nil
    }

    public func image(itemId: String, type: String, maxWidth: Int? = nil) -> URL? {
        guard var comps = URLComponents(
            url: serverURL.appendingPathComponent("/Items/\(itemId)/Images/\(type)"),
            resolvingAgainstBaseURL: false
        ) else { return nil }
        var q: [URLQueryItem] = []
        if let maxWidth { q.append(.init(name: "maxWidth", value: String(maxWidth))) }
        if let token, !token.isEmpty { q.append(.init(name: "api_key", value: token)) }
        if !q.isEmpty { comps.queryItems = q }
        return comps.url
    }

    /// A user's profile avatar (`/Users/{id}/Images/Primary`). Returns a URL
    /// even when the user has no image set — Jellyfin 404s and callers fall
    /// back to initials.
    public func userPrimary(userId: String, maxWidth: Int? = 240) -> URL? {
        guard var comps = URLComponents(
            url: serverURL.appendingPathComponent("/Users/\(userId)/Images/Primary"),
            resolvingAgainstBaseURL: false
        ) else { return nil }
        var q: [URLQueryItem] = []
        if let maxWidth { q.append(.init(name: "maxWidth", value: String(maxWidth))) }
        if let token, !token.isEmpty { q.append(.init(name: "api_key", value: token)) }
        if !q.isEmpty { comps.queryItems = q }
        return comps.url
    }

    public func subtitleVtt(itemId: String, mediaSourceId: String, streamIndex: Int) -> URL? {
        guard var comps = URLComponents(
            url: serverURL.appendingPathComponent("/Videos/\(itemId)/\(mediaSourceId)/Subtitles/\(streamIndex)/0/Stream.vtt"),
            resolvingAgainstBaseURL: false
        ) else { return nil }
        if let token, !token.isEmpty {
            comps.queryItems = [.init(name: "api_key", value: token)]
        }
        return comps.url
    }
}
