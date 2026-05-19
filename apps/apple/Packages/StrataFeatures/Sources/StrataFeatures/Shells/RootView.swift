import SwiftUI
#if canImport(CoreSpotlight) && !os(tvOS)
import CoreSpotlight
#endif
import StrataDesign
import StrataKit
import StrataPlayerUI

public struct RootView: View {
    @Environment(AppServices.self) private var services

    public init() {}

    public var body: some View {
        Group {
            if services.auth.session == nil {
                LoginView()
            } else {
                #if os(macOS)
                MacShell()
                #elseif os(tvOS)
                TVShell()
                #else
                AdaptiveShell()
                #endif
            }
        }
        .foregroundStyle(Strata.Tokens.paper)
        .background(Strata.Tokens.bg.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .onContinueUserActivity(Handoff.viewingActivityType) { activity in
            services.coordinator.handle(userActivity: activity)
        }
        .onContinueUserActivity(Handoff.watchingActivityType) { activity in
            services.coordinator.handle(userActivity: activity)
        }
        #if canImport(CoreSpotlight) && !os(tvOS)
        .onContinueUserActivity(CSSearchableItemActionType) { activity in
            services.coordinator.handle(spotlightActivity: activity)
        }
        #endif
    }
}

#if os(iOS)
struct AdaptiveShell: View {
    var body: some View {
        PhoneShell()
    }
}
#endif

struct DestinationView: View {
    @Binding var path: [Route]
    let route: Route
    var body: some View {
        switch route {
        case .movie(let id):    MovieDetailView(id: id, path: $path)
        case .show(let id):     ShowDetailView(id: id, path: $path)
        case .unified(let id):  UnifiedDetailView(id: id, path: $path)
        case .season:           EmptyView()
        case .watch(let req):   WatchView(request: req)
        }
    }
}

extension WatchRequest: Identifiable {
    public var id: String { itemId + (startSeconds.map { String($0) } ?? "") }
}

struct Sidebar: View {
    @Binding var selection: AppSection?
    @Environment(AppServices.self) private var services
    var body: some View {
        List(selection: $selection) {
            SwiftUI.Section {
                ForEach(AppSection.allCases) { sec in
                    Label(sec.title, systemImage: sec.systemImage).tag(Optional(sec))
                }
            } header: {
                Text("STRATA").strataSpec().padding(.vertical, 8)
            }
            if let name = services.auth.session?.userName {
                SwiftUI.Section {
                    Label(name, systemImage: "person.fill")
                    Button {
                        services.auth.signOut()
                        services.refreshSessionDependentServices()
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } header: {
                    Text("ACCOUNT").strataSpec().padding(.vertical, 8)
                }
            }
        }
        #if os(iOS)
        .listStyle(.sidebar)
        #endif
    }
}
