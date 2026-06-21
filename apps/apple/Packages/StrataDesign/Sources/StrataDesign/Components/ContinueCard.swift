import SwiftUI

/// Landscape "continue watching" card. Uses wide thumb / backdrop artwork
/// (16:9) instead of the 2:3 poster, overlays an episode/title label, and
/// pins a resume progress bar to the bottom edge.
public struct ContinueCard: View {
    public let id: String
    public let title: String
    public let overline: String?
    public let imageURL: URL?
    /// Fraction watched, `0...1`.
    public let progress: Double

    public init(id: String, title: String, overline: String? = nil, imageURL: URL?, progress: Double) {
        self.id = id
        self.title = title
        self.overline = overline
        self.imageURL = imageURL
        self.progress = max(0, min(progress, 1))
    }

    public var body: some View {
        let palette = StrataTheme.palette(for: id)
        let motif = StrataTheme.motif(for: id)
        ZStack(alignment: .bottomLeading) {
            Motif(key: motif, palette: palette)
            if let imageURL {
                // Color.clear drives the 16:9 layout; the scaledToFill image is
                // clipped to that frame so artwork of any aspect center-crops
                // cleanly instead of overflowing.
                Color.clear
                    .overlay(
                        AsyncImage(url: imageURL) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill().transition(.opacity)
                            default:
                                EmptyView()
                            }
                        }
                    )
                    .clipped()
            }
            LinearGradient(
                colors: [.black.opacity(0.75), .clear],
                startPoint: .bottom, endPoint: .center
            )
            // Centered play affordance so the card reads as "resume".
            Image(systemName: "play.circle.fill")
                .font(.system(size: 34))
                .foregroundStyle(Strata.Tokens.paper.opacity(0.92))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .shadow(color: .black.opacity(0.4), radius: 6)

            VStack(alignment: .leading, spacing: 3) {
                if let overline, !overline.isEmpty {
                    Text(overline)
                        .strataSpec()
                        .foregroundStyle(Strata.Tokens.paper.opacity(0.85))
                }
                Text(title)
                    .font(.fraunces(16, opticalSize: 30, soft: 60))
                    .foregroundStyle(Strata.Tokens.paper)
                    .lineLimit(1)
            }
            // Leave room for the progress bar below the text.
            .padding(.horizontal, 12)
            .padding(.bottom, 12)

            // Resume progress, pinned flush to the bottom edge.
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Strata.Tokens.paper.opacity(0.18))
                    Rectangle()
                        .fill(Strata.Tokens.accent)
                        .frame(width: geo.size.width * progress)
                }
            }
            .frame(height: 4)
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .aspectRatio(16/9, contentMode: .fit)
        .strataCard()
        .strataBorder(Strata.Tokens.paperHair)
    }
}
