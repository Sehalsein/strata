import SwiftUI
import StrataKit
import StrataDesign
#if os(iOS)
import VisionKit
#endif

/// What a scanned Strata QR code is for.
enum ScannedCode: Equatable {
    /// A member's sign-in code from the dashboard (`strata://sign-in?server=…&code=…`).
    case signIn(SignInCodeRequest)
    /// A server's address (the dashboard's "Your devices" step shows one).
    case server(String)
    /// A TV's sign-in code: approved from Settings › Link a TV, not here.
    case tvLink
    case unknown

    init(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() else {
            self = .unknown
            return
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        switch scheme {
        case "strata" where url.host == "sign-in":
            if let code = value("code"), !code.isEmpty, let server = value("server").flatMap(URL.init(string:)),
               server.scheme == "http" || server.scheme == "https", server.host != nil {
                self = .signIn(SignInCodeRequest(server: server, code: code))
            } else {
                self = .unknown
            }
        case "strata" where url.host == "link":
            self = .tvLink
        case "http", "https":
            // A TV's QR code is the server's own /link page.
            self = url.path == "/link" ? .tvLink : .server(trimmed)
        default:
            self = .unknown
        }
    }
}

#if os(iOS)
/// Scans a Strata QR code with the camera: a member's sign-in code, or a server's address.
/// Where the camera can't scan (the simulator, an old device, access refused), the link
/// can be pasted instead.
struct QRScannerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onScan: (String) -> Void
    @State private var pasted = ""

    private var canScan: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    var body: some View {
        NavigationStack {
            VStack(spacing: Metrics.space6) {
                if canScan {
                    QRDataScanner { text in
                        onScan(text)
                        dismiss()
                    }
                    .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
                    .overlay(alignment: .center) {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .strokeBorder(.white.opacity(0.8), lineWidth: 3)
                            .frame(width: 220, height: 220)
                            .allowsHitTesting(false)
                    }
                    .frame(maxHeight: 420)
                    Text("Point the camera at the QR code in your server's dashboard: someone's sign-in code (Members › Sign-in code), or the server's address.")
                        .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                } else {
                    Image(systemName: "camera.metering.unknown").font(.system(size: 44)).foregroundStyle(Theme.ink3)
                    Text(DataScannerViewController.isSupported
                         ? "Strata can't use the camera. Allow it in Settings › Strata, or paste the link below."
                         : "This device can't scan codes. Paste the link instead.")
                        .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                }
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    TextField("Or paste a link", text: $pasted, prompt: Text("Or paste a sign-in link or address"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.go)
                        .onSubmit(usePasted)
                        .modifier(FieldStyle())
                    if !pasted.trimmingCharacters(in: .whitespaces).isEmpty {
                        PrimaryButton("Continue", action: usePasted)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(Metrics.gutter)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func usePasted() {
        let text = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        onScan(text)
        dismiss()
    }
}

/// VisionKit's live scanner, QR codes only; reports the first one it reads.
private struct QRDataScanner: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onFound: (String) -> Void
        private var reported = false
        init(onFound: @escaping (String) -> Void) { self.onFound = onFound }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !reported else { return }
            for case .barcode(let code) in items {
                guard let text = code.payloadStringValue else { continue }
                reported = true
                scanner.stopScanning()
                onFound(text)
                return
            }
        }
    }
}
#endif
