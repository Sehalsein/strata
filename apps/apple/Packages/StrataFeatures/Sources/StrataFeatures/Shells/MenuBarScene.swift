#if os(macOS)
import SwiftUI
import StrataKit
import StrataDesign

/// Mac MenuBarExtra surface — pinned in the menu bar, shows the most recent
/// Continue Watching titles and routes a tap into the main window via the
/// coordinator.
public struct MenuBarScene: Scene {
    @Environment(\.openWindow) private var openWindow
    private let services: AppServices

    public init(services: AppServices) {
        self.services = services
    }

    public var body: some Scene {
        MenuBarExtra("Strata", systemImage: "film") {
            MenuBarContent(services: services)
        }
        .menuBarExtraStyle(.window)
    }
}

private struct MenuBarContent: View {
    let services: AppServices
    @State private var resume: [BaseItem] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CONTINUE WATCHING")
                .font(.mono(10))
                .tracking(1.4)
                .foregroundStyle(Strata.Tokens.paperDim)
                .padding(.bottom, 4)
            if resume.isEmpty {
                Text("Nothing in progress")
                    .font(.plex(12))
                    .foregroundStyle(Strata.Tokens.paperDim)
            } else {
                ForEach(resume.prefix(8)) { item in
                    Button {
                        services.coordinator.requestWatch(item.id, start: item.resumePositionSeconds)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.displayTitle).font(.plex(13, weight: .medium))
                            if let series = item.seriesName, item.type == .episode {
                                Text(series).font(.mono(10)).foregroundStyle(Strata.Tokens.paperDim)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
            }
            Divider().padding(.vertical, 4)
            Button("Open Strata") {
                NSApp.activate(ignoringOtherApps: true)
            }
            Button("Sign Out") {
                services.auth.signOut()
                services.refreshSessionDependentServices()
            }
        }
        .padding(14)
        .frame(width: 280)
        .background(Strata.Tokens.bg)
        .task { await load() }
    }

    private func load() async {
        guard let client = services.client else { return }
        resume = (try? await client.continueWatching()) ?? []
    }
}
#endif
