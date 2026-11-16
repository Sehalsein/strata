import SwiftUI
import StrataKit
import StrataDesign

/// "Remind Me" for a title still to come out, shown when the server offers it. Turning it on
/// asks for notifications on iPhone and iPad (the calendar's, which then include it); on the
/// TV the reminder is saved and arrives on the person's iPhone or iPad.
struct RemindButton: View {
    @Environment(AppServices.self) private var services
    let ref: TitleRef
    let reminder: Reminder
    @State private var on: Bool
    @State private var notificationsOff = false

    init(ref: TitleRef, reminder: Reminder) {
        self.ref = ref
        self.reminder = reminder
        _on = State(initialValue: reminder.on)
    }

    var body: some View {
        GlassButton(on ? String(localized: "Reminder Set", bundle: .module) : String(localized: "Remind Me", bundle: .module),
                    systemImage: on ? "bell.fill" : "bell",
                    iconOnly: !Metrics.isPadOrTV || Metrics.isTV, size: Metrics.heroControlSize) {
            Task { await toggle() }
        }
        .accessibilityHint(reminder.text.map { Text("Notifies you when it comes out: \($0)", bundle: .module) } ?? Text("Notifies you when it comes out", bundle: .module))
        .onChange(of: reminder) { on = reminder.on }
        .alert(String(localized: "Notifications are off for Strata", bundle: .module), isPresented: $notificationsOff) {
            Button(String(localized: "OK", bundle: .module), role: .cancel) {}
        } message: {
            Text("The reminder is saved. Turn notifications on in Settings › Notifications › Strata to be told on the day.", bundle: .module)
        }
    }

    private func toggle() async {
        on.toggle()
        let now = on
        if now, EpisodeAlerts.isAvailable, !EpisodeAlerts.isEnabled {
            notificationsOff = !(await EpisodeAlerts.setEnabled(true))
        }
        do { try await services.titles.setReminder(ref, now) } catch { on = !now }
    }
}
