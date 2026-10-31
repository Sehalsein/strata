import SwiftUI
import StrataKit
import StrataDesign

/// Settings for playing on this device, as Form sections to place in Settings: the
/// quality on cellular data (iPhone and iPad).
struct PlaybackSettingsSection: View {
    #if os(iOS)
    @State private var cellular = CellularQuality.current
    #endif

    var body: some View {
        #if os(iOS)
        Section {
            Picker("Cellular Quality", selection: $cellular) {
                ForEach(CellularQuality.allCases) { Text($0.label).tag($0) }
            }
            .onChange(of: cellular) { _, value in CellularQuality.current = value }
        } header: {
            Text("Playback")
        } footer: {
            Text("When Strata chooses the source on cellular data, it picks one no sharper than this. 4K can use 20 GB or more an hour. A source you choose yourself always plays as it is.")
        }
        #endif
    }
}
