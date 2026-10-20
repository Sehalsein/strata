import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

/// A QR code for `text`, dark modules on a white card so phone cameras read it
/// from across a room.
public struct QRCodeView: View {
    let text: String
    let size: CGFloat

    public init(_ text: String, size: CGFloat) {
        self.text = text
        self.size = size
    }

    public var body: some View {
        Group {
            if let image = Self.render(text) {
                Image(decorative: image, scale: 1)
                    .interpolation(.none)
                    .resizable()
            } else {
                Theme.surface2
            }
        }
        .frame(width: size, height: size)
        .padding(size * 0.06)
        .background(.white, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
        .accessibilityLabel("QR code")
    }

    private static let context = CIContext()

    static func render(_ text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        return context.createCGImage(output, from: output.extent)
    }
}
