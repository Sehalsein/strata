import SwiftUI

/// A critic or audience score from outside TMDB.
public enum ExternalRating: Hashable, Sendable {
    /// IMDb user rating, 0–10.
    case imdb(Double)
    /// Rotten Tomatoes Tomatometer, 0–100.
    case rottenTomatoes(Int)

    var value: String {
        switch self {
        case .imdb(let score): score.formatted(.number.precision(.fractionLength(1)))
        case .rottenTomatoes(let percent): "\(percent)%"
        }
    }

    var accessibilityText: String {
        switch self {
        case .imdb: "IMDb rating \(value) out of 10"
        case .rottenTomatoes: "Rotten Tomatoes \(value)"
        }
    }
}

/// "IMDb 8.1" or "🍅 94%", sized and shaped like `SpecBadge`.
public struct RatingBadge: View {
    let rating: ExternalRating

    public init(_ rating: ExternalRating) { self.rating = rating }

    private static let imdbYellow = Color(red: 0.96, green: 0.77, blue: 0.09)

    public var body: some View {
        HStack(spacing: 4) {
            switch rating {
            case .imdb:
                Text("IMDb")
                    .font(.stSpec.weight(.heavy))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 3)
                    .background(RoundedRectangle(cornerRadius: 2, style: .continuous).fill(Self.imdbYellow))
            case .rottenTomatoes:
                Text("🍅").font(.stSpec)
            }
            Text(rating.value).font(.stSpec).foregroundStyle(Theme.ink2)
        }
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, 6)
        .frame(minHeight: 20)
        .background(RoundedRectangle(cornerRadius: Metrics.radiusXS, style: .continuous).fill(Theme.surface2))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rating.accessibilityText)
    }
}
