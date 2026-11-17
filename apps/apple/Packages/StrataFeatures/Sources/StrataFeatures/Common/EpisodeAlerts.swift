import Foundation
import StrataKit
#if os(iOS)
import UserNotifications
#endif

/// Notifications for the calendar (iPhone and iPad): new episodes of followed shows, film
/// releases, and things that just became ready to play, in the server's words. The app
/// schedules them itself from the server's calendar, so the server needs no push setup;
/// they're rescheduled whenever the app comes back, the account or household changes, or My List does.
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

    /// Ready-to-play notes already shown, by entry id, so each is shown once.
    private static let deliveredKey = "episodeAlertsDelivered"

    /// Replaces this app's calendar notifications with the server's: each entry's `alert`,
    /// at its time (or that morning, for a day without one). A ready-to-play note is shown
    /// straight away, once.
    public static func schedule(_ entries: [CalendarEntry], now: Date = .now) async {
        await clear()
        guard isEnabled else { return }
        let center = UNUserNotificationCenter.current()
        var delivered = Set(UserDefaults.standard.stringArray(forKey: deliveredKey) ?? [])
        for entry in entries {
            guard let alert = entry.alert, alert.now == true, !delivered.contains(entry.id) else { continue }
            let request = UNNotificationRequest(identifier: idPrefix + "ready-" + entry.id, content: content(entry, alert), trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
            try? await center.add(request)
            delivered.insert(entry.id)
        }
        // Only ids the calendar still has are worth remembering.
        let current = Set(entries.map(\.id))
        UserDefaults.standard.set(Array(delivered.intersection(current)), forKey: deliveredKey)
        let upcoming = entries.compactMap { e -> (CalendarEntry, CalendarEntry.Alert, Date)? in
            guard let alert = e.alert, alert.now != true, let at = fireDate(e), at > now else { return nil }
            return (e, alert, at)
        }
        for (entry, alert, date) in upcoming.prefix(limit) {
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            let request = UNNotificationRequest(identifier: idPrefix + entry.id, content: content(entry, alert), trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
            try? await center.add(request)
        }
    }

    private static func content(_ entry: CalendarEntry, _ alert: CalendarEntry.Alert) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = alert.title
        content.body = alert.body
        content.sound = .default
        content.threadIdentifier = entry.ref.description
        content.userInfo = ["url": "strata://title/\(entry.ref)"]
        return content
    }

    public static func clear() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(idPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    private static func fireDate(_ entry: CalendarEntry) -> Date? {
        if entry.hasTime { return entry.when }
        return Calendar.current.date(bySettingHour: dateOnlyHour, minute: 0, second: 0, of: entry.when)
    }
    #else
    /// tvOS can't show notification banners.
    public static let isAvailable = false
    public static func setEnabled(_ on: Bool) async -> Bool { false }
    public static func schedule(_ entries: [CalendarEntry], now: Date = .now) async {}
    public static func clear() async {}
    #endif
}

public extension AppServices {
    /// Reschedules episode notifications from the active account's calendar (or clears
    /// them when signed out). Quietly keeps the old ones if the server can't be reached.
    func refreshEpisodeAlerts() async {
        guard EpisodeAlerts.isAvailable, EpisodeAlerts.isEnabled else { return }
        guard client != nil else { await EpisodeAlerts.clear(); return }
        if case .loaded(let entries) = await load({ try await $0.calendarEntries() }) {
            await EpisodeAlerts.schedule(entries)
        }
    }
}
