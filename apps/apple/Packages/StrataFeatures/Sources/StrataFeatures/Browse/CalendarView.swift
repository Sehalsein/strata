import SwiftUI
import StrataKit
import StrataDesign

/// What's coming, day by day, as the server lists it: episodes of the shows you follow and
/// releases of the films on My List, the last week and the next month, opening at today.
/// On iPhone and iPad it also turns on notifications for them.
struct CalendarView: View {
    @Environment(AppServices.self) private var services
    @State private var episodes: Loadable<[CalendarEntry]> = .loading
    @State private var alertsOn = EpisodeAlerts.isEnabled
    @State private var alertsDenied = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                TVPageHeader(title: String(localized: "Calendar", bundle: .module))
                // Lazy: weeks of days, each with its artwork; only those on screen are built.
                LazyVStack(alignment: .leading, spacing: Self.dayGap) {
                    content
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, Metrics.space4)
                .padding(.bottom, Metrics.space12)
            }
            .onChange(of: days.map(\.day)) {
                // Open at today (or the next day with episodes), not a week ago.
                if let target = days.first(where: { $0.day >= Calendar.current.startOfDay(for: .now) })?.day {
                    proxy.scrollTo(target, anchor: .top)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if !os(tvOS)
        .navigationTitle(Text("Calendar", bundle: .module))
        .toolbar {
            if EpisodeAlerts.isAvailable {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await toggleAlerts() } } label: {
                        Label(alertsOn ? String(localized: "Notifications On", bundle: .module) : String(localized: "Notify Me", bundle: .module), systemImage: alertsOn ? "bell.fill" : "bell")
                    }
                    .accessibilityHint(Text("Notifies you when new episodes and films come out, and when they're ready to play", bundle: .module))
                }
            }
            ProfileToolbarItems()
        }
        .refreshable { await load(force: true) }
        .alert(String(localized: "Notifications are off for Strata", bundle: .module), isPresented: $alertsDenied) {
            Button(String(localized: "OK", bundle: .module), role: .cancel) {}
        } message: {
            Text("Turn them on in Settings › Notifications › Strata to hear when new episodes and films come out.", bundle: .module)
        }
        #endif
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        switch episodes {
        case .loading:
            VStack(alignment: .leading, spacing: Metrics.space3) {
                SkeletonBar(width: 160, height: Metrics.isTV ? 30 : 16).skeletonPulse()
                SkeletonEpisodeRows(count: 5)
            }
        case .failed(let message):
            MessageView(systemImage: "wifi.exclamationmark", title: String(localized: "Couldn't load the calendar", bundle: .module), message: message, actionTitle: String(localized: "Try Again", bundle: .module)) {
                Task { await load() }
            }
            .frame(minHeight: 400)
        case .loaded(let list) where list.isEmpty:
            MessageView(systemImage: "calendar", title: String(localized: "Nothing on the calendar", bundle: .module),
                        message: String(localized: "Add shows and films to My List, or start watching a show, to see when new episodes and releases come out.", bundle: .module))
                .frame(minHeight: 400)
        case .loaded:
            ForEach(days, id: \.day) { day in
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text(Self.heading(day.day))
                        .modifier(DayHeadingStyle(isToday: Calendar.current.isDateInToday(day.day)))
                        .accessibilityAddTraits(.isHeader)
                    #if os(tvOS)
                    // Each episode a native TV card that lifts on focus, like the source list.
                    VStack(spacing: Metrics.space5) {
                        ForEach(day.episodes) { episode in
                            NavigationLink(value: Route.title(episode.ref)) {
                                CalendarRow(entry: episode).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.card)
                        }
                    }
                    #else
                    VStack(spacing: 0) {
                        ForEach(day.episodes) { episode in
                            // A full-width row lifts like an episode row, not like a poster.
                            NavigationLink(value: Route.title(episode.ref)) { CalendarRow(entry: episode) }
                                .buttonStyle(FocusLiftStyle())
                            if episode.id != day.episodes.last?.id { Divider().overlay(Theme.hairline) }
                        }
                    }
                    .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                    #endif
                }
                .id(day.day)
                #if os(tvOS)
                .focusSection()
                #endif
            }
        }
    }

    #if os(tvOS)
    private static let dayGap: CGFloat = Metrics.space12
    #else
    private static let dayGap: CGFloat = Metrics.space6
    #endif

    private struct Day {
        let day: Date
        let episodes: [CalendarEntry]
    }

    /// Episodes by the day they air here, in order.
    private var days: [Day] {
        let all = (episodes.value ?? []).sorted { $0.when < $1.when }
        let grouped = Dictionary(grouping: all) { Calendar.current.startOfDay(for: $0.when) }
        return grouped.keys.sorted().map { Day(day: $0, episodes: grouped[$0]!) }
    }

    /// "Today", "Tomorrow", "Yesterday", or "Friday, October 31".
    private static func heading(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return String(localized: "Today", bundle: .module) }
        if calendar.isDateInTomorrow(day) { return String(localized: "Tomorrow", bundle: .module) }
        if calendar.isDateInYesterday(day) { return String(localized: "Yesterday", bundle: .module) }
        return day.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    private func load(force: Bool = false) async {
        await services.loadCached(force: force, { try await $0.calendarEntries($1) }) { episodes = $0 }
        if case .loaded(let list) = episodes { await EpisodeAlerts.schedule(list) }
    }

    private func toggleAlerts() async {
        let on = await EpisodeAlerts.setEnabled(!alertsOn)
        alertsDenied = !alertsOn && !on
        alertsOn = on
        if on, let list = episodes.value { await EpisodeAlerts.schedule(list) }
    }
}

/// A day's heading: the rail-title size on the TV, a headline elsewhere; today in the accent.
private struct DayHeadingStyle: ViewModifier {
    let isToday: Bool

    func body(content: Content) -> some View {
        #if os(tvOS)
        content
            .font(.system(size: 34, weight: .semibold))
            .foregroundStyle(isToday ? Theme.accentText : Theme.ink.opacity(0.85))
        #else
        content
            .font(.stHeadline)
            .foregroundStyle(isToday ? Theme.accentText : Theme.ink2)
        #endif
    }
}

/// Something on the calendar: the poster, the title, the server's words for it, whether it
/// plays now, and the time when known.
private struct CalendarRow: View {
    let entry: CalendarEntry

    #if os(tvOS)
    private let thumbWidth: CGFloat = 96
    private let inset = Metrics.space5
    private let gap = Metrics.space5
    #else
    private let thumbWidth: CGFloat = 48
    private let inset = Metrics.space3
    private let gap = Metrics.space3
    #endif

    var body: some View {
        HStack(spacing: gap) {
            ArtworkImage(url: entry.posterUrl, aspectRatio: 2 / 3, seed: entry.ref.description)
                .frame(width: thumbWidth)
                #if os(tvOS)
                // The row lifts as a whole; the poster's own focus lift would pull it to the edge.
                .hoverEffectDisabled()
                #endif
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title).font(.stHeadline).foregroundStyle(Theme.ink).lineLimit(1)
                Text(entry.label).font(.stCallout).foregroundStyle(Theme.ink2).lineLimit(1)
                if entry.ready {
                    Label(String(localized: "Ready to play", bundle: .module), systemImage: "play.circle.fill")
                        .font(.stFootnote).foregroundStyle(Theme.accentText)
                }
            }
            Spacer(minLength: Metrics.space2)
            if entry.hasTime {
                Text(entry.when.formatted(date: .omitted, time: .shortened))
                    .font(.stCallout.monospacedDigit()).foregroundStyle(Theme.ink3)
            }
        }
        .padding(inset)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
