import SwiftUI
import StrataDesign
import StrataKit

public struct ChaptersRail: View {
    public let chapters: [Chapter]
    public let duration: TimeInterval
    public let position: TimeInterval
    public let onSelect: (TimeInterval) -> Void

    public init(chapters: [Chapter], duration: TimeInterval, position: TimeInterval, onSelect: @escaping (TimeInterval) -> Void) {
        self.chapters = chapters
        self.duration = duration
        self.position = position
        self.onSelect = onSelect
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CHAPTERS").strataSpec()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(chapters.indices, id: \.self) { i in
                        let chapter = chapters[i]
                        let seconds = TimeInterval(chapter.startPositionTicks) / 10_000_000
                        let isActive = isActive(index: i, seconds: seconds)
                        Button { onSelect(seconds) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(String(format: "%02d", i + 1))
                                    .font(.mono(10))
                                    .foregroundStyle(isActive ? Strata.Tokens.accent2 : Strata.Tokens.paperDim)
                                Text(chapter.name ?? "Chapter \(i + 1)")
                                    .font(.fraunces(13, opticalSize: 24, soft: 50))
                                    .foregroundStyle(Strata.Tokens.paper)
                                    .lineLimit(1)
                                Text(format(seconds))
                                    .font(.mono(9))
                                    .foregroundStyle(Strata.Tokens.paperDim)
                            }
                            .frame(width: 140, alignment: .leading)
                            .padding(10)
                            .background(isActive ? Strata.Tokens.paper.opacity(0.08) : Strata.Tokens.paper.opacity(0.03))
                            .overlay(
                                RoundedRectangle(cornerRadius: Strata.cornerRadius)
                                    .stroke(isActive ? Strata.Tokens.accent2 : Strata.Tokens.paperHair, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func isActive(index: Int, seconds: TimeInterval) -> Bool {
        let next = chapters.indices.contains(index + 1)
            ? TimeInterval(chapters[index + 1].startPositionTicks) / 10_000_000
            : duration
        return position >= seconds && position < next
    }

    private func format(_ t: TimeInterval) -> String {
        let total = Int(t), h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}
