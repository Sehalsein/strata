import SwiftUI
import StrataDesign

// MARK: - Acknowledgements

/// One piece of third-party code bundled in the app, from `Acknowledgements.plist`.
struct Acknowledgement: Decodable, Identifiable, Hashable {
    let name: String
    let version: String
    let license: String
    let notice: String
    /// A string in the plist: `URL`'s own Codable form isn't a plain string there.
    private let sourceURL: String?
    /// The flags FFmpeg was configured with, for rebuilding it to the same spec.
    let configureFlags: String?
    let licenseText: String

    var id: String { name }
    var source: URL? { sourceURL.flatMap(URL.init(string:)) }

    private struct File: Decodable { let acknowledgements: [Acknowledgement] }

    /// Everything listed in the bundled `Acknowledgements.plist`.
    static let all: [Acknowledgement] = {
        guard let url = Bundle.module.url(forResource: "Acknowledgements", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let file = try? PropertyListDecoder().decode(File.self, from: data) else { return [] }
        return file.acknowledgements
    }()
}

/// The Settings row that opens the acknowledgements.
struct AcknowledgementsRow: View {
    var body: some View {
        NavigationLink { AcknowledgementsView() } label: {
            Text("Acknowledgements")
        }
    }
}

/// Third-party code in the app, with its licence.
struct AcknowledgementsView: View {
    var body: some View {
        Form {
            Section {
                ForEach(Acknowledgement.all) { item in
                    NavigationLink { AcknowledgementDetailView(item: item) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).foregroundStyle(Theme.ink)
                            Text("\(item.version) · \(item.license)").font(.stFootnote).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            } footer: {
                Text("Strata includes the following third-party software.")
            }
        }
        .navigationTitle("Acknowledgements")
        #if !os(tvOS)
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        #endif
    }
}

/// One acknowledgement: version, notice, where its source is, and the full licence text.
struct AcknowledgementDetailView: View {
    let item: Acknowledgement

    var body: some View {
        Form {
            Section {
                LabeledContent("Version", value: item.version)
                LabeledContent("Licence", value: item.license)
            }
            Section {
                ForEach(Self.paragraphs(item.notice), id: \.self) { paragraph in
                    Text(paragraph).font(.stCallout).readable()
                }
            } header: {
                Text("Notice")
            }
            if let source = item.source {
                Section {
                    #if os(tvOS)
                    HStack(spacing: Metrics.space6) {
                        QRCodeView(source.absoluteString, size: 220)
                        Text(source.absoluteString).font(.stCallout)
                    }
                    .readable()
                    #else
                    Link(source.absoluteString, destination: source)
                    #endif
                } header: {
                    Text("Source Code")
                } footer: {
                    Text("The exact source this build of \(item.name) was made from.")
                }
            }
            if let flags = item.configureFlags {
                Section {
                    Text(flags)
                        .font(.system(.footnote, design: .monospaced))
                        #if !os(tvOS)
                        .textSelection(.enabled)
                        #endif
                        .readable()
                } header: {
                    Text("Configure Flags")
                }
            }
            Section {
                ForEach(Array(Self.paragraphs(item.licenseText).enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph)
                        .font(.system(.footnote, design: .monospaced))
                        .readable()
                }
            } header: {
                Text("Licence Text")
            }
        }
        .navigationTitle(item.name)
        #if !os(tvOS)
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        #endif
    }

    /// Splits text at blank lines, so long licences render (and, on the TV, scroll) in pieces.
    static func paragraphs(_ text: String) -> [String] {
        text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .newlines) }
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }
}

// MARK: - Privacy

/// The Settings row for the connected server's privacy page (`<server>/privacy`): opened in
/// the browser on iPhone and iPad; shown as a QR code on the TV, which has no browser.
struct PrivacyPolicyRow: View {
    let server: URL
    #if !os(tvOS)
    @Environment(\.openURL) private var openURL
    #endif

    private var url: URL { server.appending(path: "privacy") }

    var body: some View {
        #if os(tvOS)
        NavigationLink { PrivacyQRView(url: url) } label: { Text("Privacy") }
        #else
        Button { openURL(url) } label: {
            HStack {
                Text("Privacy").foregroundStyle(Theme.ink)
                Spacer()
                Image(systemName: "arrow.up.right").font(.stFootnote).foregroundStyle(Theme.ink3)
            }
        }
        #endif
    }
}

#if os(tvOS)
/// The server's privacy page as a QR code, to read on a phone.
struct PrivacyQRView: View {
    let url: URL

    var body: some View {
        VStack(spacing: Metrics.space6) {
            QRCodeView(url.absoluteString, size: 360)
            Text("Scan with your phone to read this server's privacy policy.")
                .font(.stHeadline)
            Text(url.absoluteString)
                .font(.stCallout)
                .foregroundStyle(Theme.ink3)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Privacy")
    }
}
#endif

private extension View {
    /// On the TV, lets focus land on read-only text so a long page can be scrolled.
    func readable() -> some View {
        #if os(tvOS)
        self.focusable()
        #else
        self
        #endif
    }
}
