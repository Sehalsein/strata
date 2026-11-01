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

    /// The URLs to try for what the user typed, in order. A bare domain name ("strata.example.com",
    /// no scheme, no port) is usually a hosted server behind HTTPS, so that's tried first, then a
    /// home server at the default port. IP addresses, `.local` and one-word names, and anything
    /// with a scheme or port mean just what `normalize` makes of them.
    public static func candidates(_ input: String) -> [URL] {
        guard let url = normalize(input) else { return [] }
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.contains("://"), let host = url.host,
              URLComponents(string: "http://" + text)?.port == nil,
              host.contains("."), !host.hasSuffix(".local"), !isIPAddress(host),
              let https = normalize("https://" + text)
        else { return [url] }
        return [https, url]
    }

    /// On this device or the local network: a private, link-local or loopback address, or
    /// a `.local` or one-word name. Plain HTTP is expected there.
    public static func isLocal(_ url: URL) -> Bool {
        guard let host = url.host()?.lowercased() else { return false }
        if host == "localhost" || host.hasSuffix(".local") || !host.contains(".") && !host.contains(":") { return true }
        if host.contains(":") { return host == "::1" || host.hasPrefix("fe80:") || host.hasPrefix("fd") || host.hasPrefix("fc") }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        switch (parts[0], parts[1]) {
        case (10, _), (127, _), (192, 168), (169, 254): return true
        case (172, 16...31), (100, 64...127): return true // private, and CGNAT (Tailscale)
        default: return false
        }
    }

    private static func isIPAddress(_ host: String) -> Bool {
        host.contains(":") || host.split(separator: ".").allSatisfy { !$0.isEmpty && $0.allSatisfy(\.isNumber) }
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
