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
            Label { Text("Acknowledgements", bundle: .module) } icon: { Image(systemName: "doc.text") }
        }
    }
}

/// Third-party code in the app, with its licence.
struct AcknowledgementsView: View {
    var body: some View {
        #if os(tvOS)
        TVSettingsPage {
            TVSettingsSide(systemImage: "doc.text", title: String(localized: "Acknowledgements", bundle: .module),
                           message: String(localized: "Strata includes the following third-party software.", bundle: .module))
        } content: { form }
        #else
        form
        #endif
    }

    private var form: some View {
        Form {
            Section {
                ForEach(Acknowledgement.all) { item in
                    NavigationLink { AcknowledgementDetailView(item: item) } label: {
                        // System colours, which flip with the white focused row on the TV.
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).foregroundStyle(.primary)
                            Text(verbatim: "\(item.version) · \(item.license)").font(.stFootnote).foregroundStyle(.secondary)
                        }
                    }
                }
            } footer: {
                #if !os(tvOS)
                Text("Strata includes the following third-party software.", bundle: .module)
                #endif
            }
        }
        .navigationTitle(Text("Acknowledgements", bundle: .module))
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
        #if os(tvOS)
        TVSettingsPage {
            TVSettingsSide(systemImage: "shippingbox", title: item.name,
                           message: String(localized: "Version \(item.version)", bundle: .module),
                           footnote: item.license)
        } content: { form }
        #else
        form
        #endif
    }

    private var form: some View {
        Form {
            #if !os(tvOS)
            Section {
                LabeledContent(String(localized: "Version", bundle: .module), value: item.version)
                LabeledContent(String(localized: "Licence", bundle: .module), value: item.license)
            }
            #endif
            Section {
                ForEach(Self.paragraphs(item.notice), id: \.self) { paragraph in
                    Text(paragraph).font(.stCallout).readable()
                }
            } header: {
                Text("Notice", bundle: .module)
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
                    Text("Source Code", bundle: .module)
                } footer: {
                    Text("The exact source this build of \(item.name) was made from.", bundle: .module)
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
                    Text("Configure Flags", bundle: .module)
                }
            }
            Section {
                ForEach(Array(Self.paragraphs(item.licenseText).enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph)
                        .font(.system(.footnote, design: .monospaced))
                        .readable()
                }
            } header: {
                Text("Licence Text", bundle: .module)
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

#if os(tvOS)
/// A Settings page on the TV, laid out like Settings itself: what the page is about on
/// the left, its list on the right.
struct TVSettingsPage<Side: View, Content: View>: View {
    @ViewBuilder var side: Side
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: Metrics.space20) {
            side
                .frame(width: 480)
                .padding(.top, Metrics.space12)
            // The focused row grows as it lifts: let it draw past the list's sides. Labels
            // in the primary style, which turns dark on the white focused row; not as a
            // tint, which would turn focused text in dialogs and fields white on white.
            content.scrollClipDisabled().foregroundStyle(.primary)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 120)
        .ignoresSafeArea(edges: .top)
        .background(Theme.bg.ignoresSafeArea())
        // The left column says what the page is; the bar's large title would repeat it.
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// The left column of a TV Settings page: a large symbol, the title and a line or two.
struct TVSettingsSide: View {
    let systemImage: String
    let title: String
    var message: String?
    var footnote: String?

    var body: some View {
        VStack(spacing: Metrics.space4) {
            Image(systemName: systemImage)
                .font(.system(size: 120, weight: .light))
                .foregroundStyle(Theme.ink2)
                .frame(height: 240)
            Text(title).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.6)
            if let message { Text(message).font(.stCallout).foregroundStyle(Theme.ink3) }
            if let footnote { Text(footnote).font(.stFootnote).foregroundStyle(Theme.ink3).padding(.top, Metrics.space4) }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
#endif

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
        NavigationLink { PrivacyQRView(url: url) } label: {
            Label { Text("Privacy", bundle: .module) } icon: { Image(systemName: "hand.raised") }
        }
        #else
        Button { openURL(url) } label: {
            HStack {
                Label { Text("Privacy", bundle: .module) } icon: { Image(systemName: "hand.raised") }
                    .foregroundStyle(Theme.ink)
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
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TVSettingsPage {
            TVSettingsSide(systemImage: "hand.raised", title: String(localized: "Privacy", bundle: .module),
                           message: String(localized: "Scan with your phone to read this server's privacy policy.", bundle: .module))
        } content: {
            // Nothing here is a button, so the page itself takes focus: with no focus on the
            // page, Menu had nowhere to go and the page couldn't be left.
            VStack(spacing: Metrics.space6) {
                QRCodeView(url.absoluteString, size: 420)
                Text(url.absoluteString).font(.stCallout).foregroundStyle(Theme.ink3)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, Metrics.space12)
            .focusable()
            .focusEffectDisabled()
            .onExitCommand { dismiss() }
        }
        .navigationTitle(Text("Privacy", bundle: .module))
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
