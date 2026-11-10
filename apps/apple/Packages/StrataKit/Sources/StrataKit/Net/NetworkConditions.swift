import Foundation
import Network

/// The quality to stream at on cellular data (4K straight from TorBox can use 20 GB or
/// more an hour). Applies when the app chooses the source, not when you pick one.
public enum CellularQuality: Int, CaseIterable, Identifiable, Sendable {
    case best = 0
    case hd1080 = 1080
    case hd720 = 720

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .best: "Best Available"
        case .hd1080: "Up to 1080p"
        case .hd720: "Up to 720p"
        }
    }

    static let key = "strata.cellularMaxHeight"

    /// The saved choice; up to 1080p unless changed.
    public static var current: CellularQuality {
        get {
            let raw = UserDefaults.standard.object(forKey: key) as? Int
            return raw.flatMap(CellularQuality.init(rawValue:)) ?? .hd1080
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: key) }
    }

    /// The tallest source to prefer, nil for no limit.
    var maxHeight: Int? { self == .best ? nil : rawValue }
}

/// Whether the device is on cellular data (or another connection the system marks as
/// expensive, such as a personal hotspot) or offline.
public final class NetworkConditions: @unchecked Sendable {
    public static let shared = NetworkConditions()

    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var path: NWPath?
    private var listeners: [UUID: @Sendable (Bool) -> Void] = [:]

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            self.lock.lock()
            let wasOnline = self.path?.status == .satisfied
            self.path = path
            let listeners = Array(self.listeners.values)
            self.lock.unlock()
            let online = path.status == .satisfied
            if online != wasOnline { for fn in listeners { fn(online) } }
        }
        monitor.start(queue: DispatchQueue(label: "strata.network"))
    }

    /// On cellular data or an expensive connection.
    public var isExpensive: Bool {
        lock.lock(); defer { lock.unlock() }
        guard let path else { return false }
        return path.isExpensive || path.usesInterfaceType(.cellular)
    }

    /// Connected to some network (unknown counts as online until the first update).
    public var isOnline: Bool {
        lock.lock(); defer { lock.unlock() }
        return path.map { $0.status == .satisfied } ?? true
    }

    /// Called with the new state whenever the device goes on or offline.
    @discardableResult
    public func onReachabilityChange(_ fn: @escaping @Sendable (Bool) -> Void) -> UUID {
        let id = UUID()
        lock.lock(); listeners[id] = fn; lock.unlock()
        return id
    }

    /// The source height to prefer when the app chooses: the cellular setting while on
    /// cellular, and at most 1080p on an iPhone anywhere (a 4K remux is many times the
    /// data, starts and seeks slower, and looks no sharper on a phone). A source you pick
    /// yourself plays whatever its resolution.
    public var preferredMaxHeight: Int? {
        let cellular = isExpensive ? CellularQuality.current.maxHeight : nil
        let device = DeviceInfo.deviceClass == "iPhone" ? 1080 : nil
        return [cellular, device].compactMap { $0 }.min()
    }
}
