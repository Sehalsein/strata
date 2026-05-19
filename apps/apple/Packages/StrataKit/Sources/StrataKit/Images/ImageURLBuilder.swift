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
