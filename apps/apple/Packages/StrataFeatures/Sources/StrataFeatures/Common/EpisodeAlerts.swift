import Foundation
import StrataKit
#if os(iOS)
import UserNotifications
#endif

/// Notifications when episodes of the shows on My List air (iPhone and iPad). The app
/// schedules them itself from the server's calendar, so the server needs no push setup;
/// they're rescheduled whenever the app comes back, the profile changes or My List does.
@MainActor
public enum EpisodeAlerts {
    private static let enabledKey = "episodeAlerts"
    private static let idPrefix = "episode-"
    /// iOS keeps at most 64 pending notifications per app.
    private static let limit = 60
    /// A TMDB air date has no time: tell people that morning.
    private static let dateOnlyHour = 9

    /// Whether this device notifies (off until turned on from the Calendar).
    public static var isEnabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }

    #if os(iOS)
    public static let isAvailable = true

    /// Turns notifications on (asking permission the first time) or off. Returns whether
    /// they're on: false if permission was refused.
    public static func setEnabled(_ on: Bool) async -> Bool {
        let center = UNUserNotificationCenter.current()
        var granted = on
        if on { granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false }
        UserDefaults.standard.set(granted, forKey: enabledKey)
        if !granted { await clear() }
        return granted
    }

    /// Replaces this app's episode notifications with the calendar's upcoming episodes.
    public static func schedule(_ episodes: [CalendarEpisode], now: Date = .now) async {
        await clear()
        guard isEnabled else { return }
        let center = UNUserNotificationCenter.current()
        for episode in episodes.compactMap({ e in fireDate(e).map { (e, $0) } }).filter({ $0.1 > now }).prefix(limit) {
            let (item, date) = episode
            let content = UNMutableNotificationContent()
            content.title = item.title
            let what = [item.code, item.name].compactMap { $0 }.joined(separator: " · ")
            content.body = item.hasTime ? "\(what) is out now." : "\(what) airs today."
            content.sound = .default
            content.threadIdentifier = "show-\(item.tmdbId)"
            content.userInfo = ["url": "strata://show/\(item.tmdbId)"]
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            let request = UNNotificationRequest(identifier: idPrefix + item.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
            try? await center.add(request)
        }
    }

    public static func clear() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(idPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    private static func fireDate(_ episode: CalendarEpisode) -> Date? {
        if episode.hasTime { return episode.date }
        return Calendar.current.date(bySettingHour: dateOnlyHour, minute: 0, second: 0, of: episode.date)
    }
    #else
    /// tvOS can't show notification banners.
    public static let isAvailable = false
    public static func setEnabled(_ on: Bool) async -> Bool { false }
    public static func schedule(_ episodes: [CalendarEpisode], now: Date = .now) async {}
    public static func clear() async {}
    #endif
}

public extension AppServices {
    /// Reschedules episode notifications from the active profile's calendar (or clears
    /// them when signed out). Quietly keeps the old ones if the server can't be reached.
    func refreshEpisodeAlerts() async {
        guard EpisodeAlerts.isAvailable, EpisodeAlerts.isEnabled else { return }
        guard client != nil else { await EpisodeAlerts.clear(); return }
        if case .loaded(let episodes) = await load({ try await $0.calendar() }) {
            await EpisodeAlerts.schedule(episodes)
        }
    }
}
