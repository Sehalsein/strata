import Foundation

/// Turns what a user types ("192.168.1.20", "nas.local:8420", "https://strata.example.com/")
/// into a base URL the client can use.
public enum ServerAddress {
    public static let defaultPort = 8420

    /// - `http://` is added when no scheme is given.
    /// - Plain-HTTP addresses without a port get the default Strata port (8420); HTTPS keeps
    ///   its default (443), since that's almost always a reverse proxy.
    /// - Path, query, fragment and trailing slashes are dropped; scheme and host are lowercased.
    public static func normalize(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(" ") else { return nil }
        if !text.contains("://") { text = "http://" + text }
        guard var comps = URLComponents(string: text),
              let scheme = comps.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = comps.host, !host.isEmpty
        else { return nil }
        comps.scheme = scheme
        comps.host = host.lowercased()
        if comps.port == nil, scheme == "http" { comps.port = defaultPort }
        comps.path = ""
        comps.query = nil
        comps.fragment = nil
        comps.user = nil
        comps.password = nil
        return comps.url
    }

    /// "host:port" for messages.
    public static func display(_ url: URL) -> String {
        guard let host = url.host else { return url.absoluteString }
        let h = host.contains(":") ? "[\(host)]" : host
        if let port = url.port { return "\(h):\(port)" }
        return h
    }

    /// Resolves a server-relative URL ("/api/stream/…") against `base`. Absolute URLs pass through.
    public static func resolve(_ url: URL, against base: URL) -> URL {
        if url.scheme != nil { return url }
        return URL(string: url.relativeString, relativeTo: base)?.absoluteURL ?? url
    }
}
