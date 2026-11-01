import StrataDesign
import StrataKit

extension Optional where Wrapped == ExternalRatings {
    /// The hero's IMDb and Rotten Tomatoes badges, in that order.
    var badges: [ExternalRating] {
        guard let self else { return [] }
        return [self.imdb.map(ExternalRating.imdb), self.rottenTomatoes.map(ExternalRating.rottenTomatoes)].compactMap { $0 }
    }

    /// TMDB's own score only when IMDb's isn't shown, so the line doesn't carry two.
    func tmdbStar(_ ratingText: String?) -> String? {
        self?.imdb == nil ? ratingText.map { "★ \($0)" } : nil
    }
}
