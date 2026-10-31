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
            Picker("Cellular Quality", selection: $cellular) {
                ForEach(CellularQuality.allCases) { Text($0.label).tag($0) }
            }
            .onChange(of: cellular) { _, value in CellularQuality.current = value }
        } header: {
            Text("Playback")
        } footer: {
            Text("When Strata chooses the source on cellular data, it picks one no sharper than this. 4K can use 20 GB or more an hour. A source you choose yourself always plays as it is.")
        }
        downloads
        #endif
    }

    #if os(iOS)
    @ViewBuilder private var downloads: some View {
        @Bindable var store = DownloadStore.shared
        Section {
            NavigationLink { DownloadsView() } label: {
                LabeledContent("Downloads", value: Formatting.size(bytes: Int(store.bytesUsed)) ?? "None")
            }
            Toggle("Download on Cellular", isOn: $store.allowsCellular)
            if !store.items.isEmpty {
                Button("Delete All Downloads", role: .destructive) { confirmDeleteAll = true }
                    .confirmationDialog("Delete all downloads on this device?", isPresented: $confirmDeleteAll, titleVisibility: .visible) {
                        Button("Delete All", role: .destructive) { store.removeAll() }
                    } message: {
                        Text("Every profile's downloads on this device are deleted. They can be downloaded again.")
                    }
            }
        } header: {
            Text("Downloads")
        } footer: {
            if let free = DownloadStore.freeSpace, let text = Formatting.size(bytes: Int(free)) {
                Text("\(text) free on this device. Downloads use Wi-Fi unless Download on Cellular is on.")
            }
        }
    }
    #endif
}
