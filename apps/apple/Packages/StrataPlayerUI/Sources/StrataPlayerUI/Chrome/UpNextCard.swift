import SwiftUI
import StrataKit
import StrataDesign

public struct UpNextCard: View {
    public let next: BaseItem
    public let images: ImageURLBuilder?
    public let countdown: Int
    public let onPlay: () -> Void
    public let onDismiss: () -> Void

    public init(next: BaseItem, images: ImageURLBuilder?, countdown: Int, onPlay: @escaping () -> Void, onDismiss: @escaping () -> Void) {
        self.next = next
        self.images = images
        self.countdown = countdown
        self.onPlay = onPlay
        self.onDismiss = onDismiss
    }

    public var body: some View {
        GlassPanel(strong: true) {
            HStack(alignment: .top, spacing: 14) {
                if let url = images?.thumb(itemId: next.id) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let img):
                            img.resizable().scaledToFill()
                        default:
                            Strata.Tokens.bg2
                        }
                    }
                    .frame(width: 160, height: 90)
                    .strataCard()
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text("UP NEXT IN \(countdown)s").strataSpec()
                            .foregroundStyle(Strata.Tokens.accent2)
                    }
                    Text(next.displayTitle)
                        .font(.fraunces(18, opticalSize: 36, soft: 50))
                        .foregroundStyle(Strata.Tokens.paper)
                    if let n = next.indexNumber {
                        Text("E\(n)").font(.mono(10)).foregroundStyle(Strata.Tokens.paperDim)
                    }
                    HStack(spacing: 8) {
                        PrimaryButton("Play Next", systemImage: "forward.fill", action: onPlay)
                        SecondaryButton("Cancel", systemImage: "xmark", action: onDismiss)
                    }
                    .padding(.top, 4)
                }
                Spacer()
            }
        }
        .frame(maxWidth: 480)
    }
}
