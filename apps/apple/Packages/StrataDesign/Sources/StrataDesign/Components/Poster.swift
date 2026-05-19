import SwiftUI

/// Editorial poster card. If `imageURL` resolves, the remote artwork takes
/// precedence over the procedural motif. The motif still renders behind as a
/// theme-coherent fallback while the image loads.
public struct Poster: View {
    public let id: String
    public let title: String
    public let imageURL: URL?
    public let aspect: CGFloat

    public init(id: String, title: String, imageURL: URL?, aspect: CGFloat = 2/3) {
        self.id = id
        self.title = title
        self.imageURL = imageURL
        self.aspect = aspect
    }

    public var body: some View {
        let palette = StrataTheme.palette(for: id)
        let motif = StrataTheme.motif(for: id)
        ZStack(alignment: .bottomLeading) {
            Motif(key: motif, palette: palette)
            if let imageURL {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill().transition(.opacity)
                    default:
                        EmptyView()
                    }
                }
            }
            LinearGradient(
                colors: [.black.opacity(0.65), .clear],
                startPoint: .bottom, endPoint: .center
            )
            VStack(alignment: .leading, spacing: 4) {
                Text("№ \(StrataTheme.opus(for: id))")
                    .strataSpec()
                    .foregroundStyle(Strata.Tokens.paper.opacity(0.85))
                Text(title)
                    .font(.fraunces(16, opticalSize: 30, soft: 60))
                    .foregroundStyle(Strata.Tokens.paper)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .padding(10)
        }
        .aspectRatio(aspect, contentMode: .fit)
        .strataCard()
        .strataBorder(Strata.Tokens.paperHair)
    }
}
