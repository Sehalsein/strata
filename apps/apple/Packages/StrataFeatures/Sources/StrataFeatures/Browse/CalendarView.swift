import SwiftUI
import StrataKit
import StrataDesign

/// Episodes of the shows on My List, day by day: the last week and the next month,
/// opening at today. On iPhone and iPad it also turns on notifications for new episodes.
struct CalendarView: View {
    @Environment(AppServices.self) private var services
    @State private var episodes: Loadable<[CalendarEpisode]> = .loading
    @State private var alertsOn = EpisodeAlerts.isEnabled
    @State private var alertsDenied = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space6) {
                    #if os(tvOS)
                    Color.clear.frame(height: 120) // clear the top tab bar
                    #endif
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
        #if os(tvOS)
        .ignoresSafeArea(edges: .top)
        #else
        .navigationTitle("Calendar")
        .toolbar {
            if EpisodeAlerts.isAvailable {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await toggleAlerts() } } label: {
                        Label(alertsOn ? "Notifications On" : "Notify Me", systemImage: alertsOn ? "bell.fill" : "bell")
                    }
                    .accessibilityHint("Notifies you when episodes of shows on My List air")
                }
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
            ToolbarItem(placement: .primaryAction) { ProfileToolbarButton() }
        }
        .refreshable { await services.client?.clearCache(); await load() }
        .alert("Notifications are off for Strata", isPresented: $alertsDenied) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Turn them on in Settings › Notifications › Strata to hear when new episodes air.")
        }
        #endif
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        switch episodes {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, minHeight: 300)
        case .failed(let message):
            MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load the calendar", message: message, actionTitle: "Try Again") {
                Task { await load() }
            }
            .frame(minHeight: 400)
        case .loaded(let list) where list.isEmpty:
            MessageView(systemImage: "calendar", title: "Nothing on the calendar",
                        message: "Add shows and anime to My List to see when new episodes air.")
                .frame(minHeight: 400)
        case .loaded:
            ForEach(days, id: \.day) { day in
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text(Self.heading(day.day))
                        .font(.stHeadline)
                        .foregroundStyle(Calendar.current.isDateInToday(day.day) ? Theme.accentText : Theme.ink2)
                        .accessibilityAddTraits(.isHeader)
                    VStack(spacing: 0) {
                        ForEach(day.episodes) { episode in
                            NavigationLink(value: Route.show(episode.tmdbId)) { CalendarRow(episode: episode) }
                                .buttonStyle(StrataCardStyle())
                            if episode.id != day.episodes.last?.id { Divider().overlay(Theme.hairline) }
                        }
                    }
                    .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                }
                .id(day.day)
                #if os(tvOS)
                .focusSection()
                #endif
            }
        }
    }

    private struct Day {
        let day: Date
        let episodes: [CalendarEpisode]
    }

    /// Episodes by the day they air here, in order.
    private var days: [Day] {
        let all = (episodes.value ?? []).sorted { $0.date < $1.date }
        let grouped = Dictionary(grouping: all) { Calendar.current.startOfDay(for: $0.date) }
        return grouped.keys.sorted().map { Day(day: $0, episodes: grouped[$0]!) }
    }

    /// "Today", "Tomorrow", "Yesterday", or "Friday, October 31".
    private static func heading(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInTomorrow(day) { return "Tomorrow" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    private func load() async {
        let result = await services.load { try await $0.calendar() }
        if case .loading = result { return }
        episodes = result
        if case .loaded(let list) = result { await EpisodeAlerts.schedule(list) }
    }

    private func toggleAlerts() async {
        let on = await EpisodeAlerts.setEnabled(!alertsOn)
        alertsDenied = !alertsOn && !on
        alertsOn = on
        if on, let list = episodes.value { await EpisodeAlerts.schedule(list) }
    }
}

/// An episode on the calendar: the show's poster, its name, the episode and when it airs.
private struct CalendarRow: View {
    let episode: CalendarEpisode

    #if os(tvOS)
    private let thumbWidth: CGFloat = 80
    #else
    private let thumbWidth: CGFloat = 48
    #endif

    var body: some View {
        HStack(spacing: Metrics.space3) {
            ArtworkImage(url: episode.posterUrl, aspectRatio: 2 / 3, seed: "show-\(episode.tmdbId)")
                .frame(width: thumbWidth)
            VStack(alignment: .leading, spacing: 3) {
                Text(episode.title).font(.stHeadline).foregroundStyle(Theme.ink).lineLimit(1)
                Text([episode.code, episode.name].compactMap { $0 }.joined(separator: " · "))
                    .font(.stCallout).foregroundStyle(Theme.ink2).lineLimit(1)
                if episode.available {
                    Label("In your library", systemImage: "checkmark.circle.fill")
                        .font(.stFootnote).foregroundStyle(Theme.accentText)
                }
            }
            Spacer(minLength: Metrics.space2)
            if episode.hasTime {
                Text(episode.date.formatted(date: .omitted, time: .shortened))
                    .font(.stCallout.monospacedDigit()).foregroundStyle(Theme.ink3)
            }
        }
        .padding(Metrics.space3)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
