import SwiftUI
import StrataKit
import StrataDesign

#if os(iOS)
/// Settings › Your data: a copy of everything the server keeps about this profile, and
/// deleting the account with all of it (with its password).
struct YourDataSection: View {
    @Environment(AppServices.self) private var services
    @State private var exporting = false
    @State private var exportFile: URL?
    @State private var exportError: String?
    @State private var deleting = false

    var body: some View {
        Section {
            if let exportFile {
                ShareLink(item: exportFile) { Label("Save or Share My Data", systemImage: "square.and.arrow.up") }
            } else {
                Button {
                    Task { await export() }
                } label: {
                    HStack {
                        Label("Download My Data", systemImage: "arrow.down.doc")
                        Spacer()
                        if exporting { ProgressView() }
                    }
                }
                .disabled(exporting)
            }
            Button(role: .destructive) { deleting = true } label: {
                Label("Delete Account…", systemImage: "trash")
            }
            .foregroundStyle(Theme.danger)
        } header: {
            Text("Your Data")
        } footer: {
            if let exportError {
                Text(exportError).foregroundStyle(Theme.danger)
            } else {
                Text("A file of your account, devices, watch history and My List; or delete your account and all of it.")
            }
        }
        .sheet(isPresented: $deleting) { DeleteAccountView() }
    }

    private func export() async {
        exporting = true
        exportError = nil
        defer { exporting = false }
        do {
            let data = try await services.store.exportMyData()
            let name = "strata-\(services.store.active?.username ?? "account")-data.json"
            let url = FileManager.default.temporaryDirectory.appending(path: name)
            try data.write(to: url, options: .atomic)
            exportFile = url
        } catch {
            exportError = StrataError.wrap(error).message
        }
    }
}

/// Deletes the active account after its password is entered.
private struct DeleteAccountView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This deletes \(services.store.active?.name ?? "your")'s account, watch history, My List and sign-ins for good, on every device. It can't be undone.")
                        .font(.stCallout)
                }
                Section {
                    SecureField("Your password, to confirm", text: $password).textContentType(.password)
                } footer: {
                    if let error { Text(error).foregroundStyle(Theme.danger) }
                }
                Section {
                    Button(role: .destructive) {
                        Task { await delete() }
                    } label: {
                        HStack {
                            Text("Delete My Account")
                            Spacer()
                            if working { ProgressView() }
                        }
                    }
                    .disabled(password.isEmpty || working)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func delete() async {
        working = true
        error = nil
        defer { working = false }
        do {
            try await services.store.deleteAccount(password: password)
            services.refreshClient()
            dismiss()
        } catch {
            let e = StrataError.wrap(error)
            self.error = e.code == "INVALID_PASSWORD" ? "That password isn't right." : e.message
        }
    }
}
#endif
