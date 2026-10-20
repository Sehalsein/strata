import Foundation
import Network
import Observation

/// A Strata server found on the local network.
public struct DiscoveredServer: Sendable, Hashable, Identifiable {
    /// The server's stable id (TXT `id`), or the service name if it didn't advertise one.
    public var id: String
    /// Bonjour instance name (the server's display name).
    public var name: String
    public var version: String?
    public var apiVersion: Int?
    /// Connectable base URL, e.g. `http://192.168.1.20:8420`.
    public var url: URL

    public var isCompatible: Bool { apiVersion.map { $0 == ServerInfo.supportedAPIVersion } ?? true }
}

/// Finds Strata servers advertised over Bonjour (`_strata._tcp`).
///
/// The app needs these Info.plist keys:
/// - `NSBonjourServices`: [`_strata._tcp`]
/// - `NSLocalNetworkUsageDescription`: why the app looks for servers on the network.
@MainActor
@Observable
public final class ServerBrowser {
    public enum State: Sendable, Equatable {
        case idle
        case browsing
        /// Local-network permission was denied (Settings ▸ Privacy ▸ Local Network).
        case denied
        case failed(String)
    }

    public static let serviceType = "_strata._tcp"

    /// Resolved servers, sorted by name.
    public private(set) var servers: [DiscoveredServer] = []
    public private(set) var state: State = .idle

    private var browser: NWBrowser?
    private var resolving: [NWEndpoint: NWConnection] = [:]
    private var resolved: [NWEndpoint: DiscoveredServer] = [:]
    private let queue = DispatchQueue(label: "strata.bonjour")

    public init() {}

    public func start() {
        guard browser == nil else { return }
        let params = NWParameters()
        params.includePeerToPeer = false
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: "local."), using: params)
        browser.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in self?.handle(state) }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in self?.update(results) }
        }
        self.browser = browser
        state = .browsing
        browser.start(queue: queue)
    }

    public func stop() {
        browser?.cancel()
        browser = nil
        resolving.values.forEach { $0.cancel() }
        resolving.removeAll()
        resolved.removeAll()
        servers = []
        state = .idle
    }

    /// Stop and start again (e.g. a "Refresh" button, or after permission is granted).
    public func restart() {
        stop()
        start()
    }

    private func handle(_ newState: NWBrowser.State) {
        switch newState {
        case .ready:
            state = .browsing
        case .failed(let error), .waiting(let error):
            if case .dns(let code) = error, code == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) {
                state = .denied
            } else if case .failed = newState {
                state = .failed(error.localizedDescription)
                browser?.cancel()
                browser = nil
            }
        case .cancelled:
            if state == .browsing { state = .idle }
        default:
            break
        }
    }

    private func update(_ results: Set<NWBrowser.Result>) {
        let endpoints = Set(results.map(\.endpoint))
        for gone in resolved.keys where !endpoints.contains(gone) { resolved[gone] = nil }
        for (ep, conn) in resolving where !endpoints.contains(ep) {
            conn.cancel()
            resolving[ep] = nil
        }
        for result in results where resolved[result.endpoint] == nil && resolving[result.endpoint] == nil {
            guard case .service(let name, _, _, _) = result.endpoint else { continue }
            var txt: [String: String] = [:]
            if case .bonjour(let record) = result.metadata { txt = record.dictionary }
            resolve(result.endpoint, name: name, txt: txt, ipv4Only: true)
        }
        publish()
    }

    /// Opens a throwaway TCP connection to the service to learn its address, preferring IPv4.
    private func resolve(_ endpoint: NWEndpoint, name: String, txt: [String: String], ipv4Only: Bool) {
        let params = NWParameters.tcp
        if ipv4Only, let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let conn = NWConnection(to: endpoint, using: params)
        resolving[endpoint] = conn
        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let conn else { return }
            let remote = conn.currentPath?.remoteEndpoint
            Task { @MainActor in
                self?.connection(conn, for: endpoint, name: name, txt: txt, ipv4Only: ipv4Only, state: state, remote: remote)
            }
        }
        conn.start(queue: queue)
        // Don't wait forever on a server that never answers.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard let self, self.resolving[endpoint] === conn else { return }
            conn.cancel()
            self.resolving[endpoint] = nil
            if ipv4Only { self.resolve(endpoint, name: name, txt: txt, ipv4Only: false) }
        }
    }

    private func connection(_ conn: NWConnection, for endpoint: NWEndpoint, name: String, txt: [String: String],
                            ipv4Only: Bool, state: NWConnection.State, remote: NWEndpoint?) {
        guard resolving[endpoint] === conn else { return }
        switch state {
        case .ready:
            conn.cancel()
            resolving[endpoint] = nil
            guard let remote, let url = Self.url(for: remote) else { return }
            resolved[endpoint] = DiscoveredServer(
                id: txt["id"].flatMap { $0.isEmpty ? nil : $0 } ?? name,
                name: name,
                version: txt["version"],
                apiVersion: txt["api"].flatMap(Int.init),
                url: url
            )
            publish()
        case .failed, .waiting:
            conn.cancel()
            resolving[endpoint] = nil
            // No IPv4 route (IPv6-only network): try any address family.
            if ipv4Only { resolve(endpoint, name: name, txt: txt, ipv4Only: false) }
        default:
            break
        }
    }

    private func publish() {
        // One entry per server id (a server may be seen on several interfaces).
        var byId: [String: DiscoveredServer] = [:]
        for s in resolved.values {
            if let existing = byId[s.id], existing.url.host?.contains(":") == false { continue }
            byId[s.id] = s
        }
        servers = byId.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// `http://host:port` for a resolved endpoint; IPv6 hosts are bracketed and the zone is dropped.
    nonisolated static func url(for endpoint: NWEndpoint) -> URL? {
        guard case .hostPort(let host, let port) = endpoint else { return nil }
        let hostString: String
        switch host {
        case .ipv4(let addr):
            hostString = "\(addr)".split(separator: "%").first.map(String.init) ?? "\(addr)"
        case .ipv6(let addr):
            let raw = "\(addr)".split(separator: "%").first.map(String.init) ?? "\(addr)"
            hostString = "[\(raw)]"
        case .name(let name, _):
            hostString = name
        @unknown default:
            return nil
        }
        return URL(string: "http://\(hostString):\(port.rawValue)")
    }
}
