import SwiftUI
#if canImport(CoreSpotlight) && !os(tvOS)
import CoreSpotlight
#endif
import StrataDesign
import StrataKit
import StrataPlayerUI

public struct RootView: View {
    @Environment(AppServices.self) private var services
    #if os(tvOS)
    // On Apple TV a shared device shows a "Who's watching?" gate at launch
    // when more than one profile is saved. Cleared on sign-out so it returns.
    @State private var profileChosen = false
    #endif

    public init() {}

    public var body: some View {
        Group {
            if services.auth.session == nil {
                LoginView()
            } else {
                #if os(macOS)
                MacShell()
                #elseif os(tvOS)
                if services.auth.savedAccounts.count > 1 && !profileChosen {
                    ProfileGateView(onChosen: { profileChosen = true })
                } else {
                    TVShell()
                }
                #else
                AdaptiveShell()
                #endif
            }
        }
        #if os(tvOS)
        .onChange(of: services.auth.session?.userId) { _, newValue in
            // Returning to no session (signed out of every profile) re-arms the
            // gate so the next sign-in lands on the chooser again.
            if newValue == nil { profileChosen = false }
        }
        #endif
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
        case .movie(let id):    MovieDetailView(id: id, path: $path).editorialDetailChrome()
        case .show(let id):     ShowDetailView(id: id, path: $path).editorialDetailChrome()
        case .unified(let id):  UnifiedDetailView(id: id, path: $path).editorialDetailChrome()
        case .collection(let id): CollectionDetailView(id: id, path: $path).editorialDetailChrome()
        case .season:           EmptyView()
        case .watch(let req):   WatchView(request: req)
        case .search(let q):    SearchView(path: $path, initialQuery: q)
        case .genre(let name, let forShows): GenreView(path: $path, name: name, forShows: forShows)
        case .myList:           MyListView(path: $path)
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
