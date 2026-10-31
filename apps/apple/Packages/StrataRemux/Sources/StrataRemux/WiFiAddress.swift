import Foundation

/// This device's IPv4 address on the local network, which other devices reach: Wi-Fi
/// (en0 on iPhone and iPad), else another Ethernet-style interface (a Mac's en1).
enum WiFiAddress {
    static func current() -> String? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        var found: [(name: String, address: String)] = []
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let entry = pointer.pointee
            let name = String(cString: entry.ifa_name)
            guard let addr = entry.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET), name.hasPrefix("en"),
                  (Int32(entry.ifa_flags) & IFF_UP) != 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            found.append((name, String(cString: host)))
        }
        return (found.first { $0.name == "en0" } ?? found.first)?.address
    }
}
