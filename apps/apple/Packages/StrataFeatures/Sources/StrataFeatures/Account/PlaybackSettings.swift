import SwiftUI
import StrataKit
import StrataDesign

/// Settings for playing on this device, as Form sections to place in Settings: the
/// quality on cellular data, and downloads with the space they take (iPhone and iPad).
struct PlaybackSettingsSection: View {
    #if os(iOS)
    @State private var cellular = CellularQuality.current
    @State private var confirmDeleteAll = false
    #endif

    var body: some View {
        #if os(iOS)
        Section {
            Picker(String(localized: "Cellular Quality", bundle: .module), selection: $cellular) {
                ForEach(CellularQuality.allCases) { Text($0.label).tag($0) }
            }
            .onChange(of: cellular) { _, value in CellularQuality.current = value }
        } header: {
            Text("Playback", bundle: .module)
        } footer: {
            Text("When Strata chooses the source on cellular data, it picks one no sharper than this. 4K can use 20 GB or more an hour. A source you choose yourself always plays as it is.", bundle: .module)
        }
        downloads
        #endif
    }

    #if os(iOS)
    @ViewBuilder private var downloads: some View {
        @Bindable var store = DownloadStore.shared
        Section {
            NavigationLink { DownloadsView() } label: {
                LabeledContent(String(localized: "Downloads", bundle: .module), value: Formatting.size(bytes: Int(store.bytesUsed)) ?? String(localized: "None", bundle: .module))
            }
            Toggle(String(localized: "Download on Cellular", bundle: .module), isOn: $store.allowsCellular)
            if !store.items.isEmpty {
                Button(String(localized: "Delete All Downloads", bundle: .module), role: .destructive) { confirmDeleteAll = true }
                    .confirmationDialog(String(localized: "Delete all downloads on this device?", bundle: .module), isPresented: $confirmDeleteAll, titleVisibility: .visible) {
                        Button(String(localized: "Delete All", bundle: .module), role: .destructive) { store.removeAll() }
                    } message: {
                        Text("Every profile's downloads on this device are deleted. They can be downloaded again.", bundle: .module)
                    }
            }
        } header: {
            Text("Downloads", bundle: .module)
        } footer: {
            if let free = DownloadStore.freeSpace, let text = Formatting.size(bytes: Int(free)) {
                Text("\(text) free on this device. Downloads use Wi-Fi unless Download on Cellular is on.", bundle: .module)
            }
        }
    }
    #endif
}
