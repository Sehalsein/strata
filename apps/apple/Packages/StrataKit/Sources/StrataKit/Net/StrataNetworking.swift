import Foundation

/// Shared networking configuration: a big on-disk URL cache (so remote artwork
/// loaded through `AsyncImage` → `URLSession.shared` → `URLCache.shared`
/// survives across launches instead of re-downloading every session) and a
/// dedicated API session with explicit timeouts.
public enum StrataNetworking {
    /// Installs a large shared `URLCache`. Idempotent; call once at launch
    /// before the first image or request goes out.
    public static func configureSharedCaches() {
        // 64 MB memory / 512 MB disk is plenty for poster/backdrop art and
        // makes a cold tab revisit paint instantly from disk.
        let cache = URLCache(memoryCapacity: 64 * 1024 * 1024,
                             diskCapacity: 512 * 1024 * 1024,
                             diskPath: "strata-url-cache")
        URLCache.shared = cache
    }

    /// Session for all Strata API calls. Explicit `timeoutIntervalForRequest`
    /// means a flaky connection fails in ~20s instead of hanging on the 60s
    /// system default; the shared cache enables conditional revalidation.
    public static let apiSession: URLSession = {
        configureSharedCaches()
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 20
        cfg.timeoutIntervalForResource = 60
        cfg.urlCache = URLCache.shared
        cfg.requestCachePolicy = .useProtocolCachePolicy
        return URLSession(configuration: cfg)
    }()
}
