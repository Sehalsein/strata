import SwiftUI
import StrataDesign
import StrataKit

/// Renders the active WebVTT cue with Cinemathèque type — Fraunces display
/// in paper cream with a hard drop shadow on warm ink.
public struct SubtitleOverlay: View {
    @Bindable var engine: PlayerEngine
    @State private var cues: [VTTCue] = []
    @State private var loadedKey: String?

    public init(engine: PlayerEngine) {
        self.engine = engine
    }

    public var body: some View {
        let current = cues.first(where: { engine.position >= $0.start && engine.position <= $0.end })
        VStack {
            Spacer()
            if let cue = current {
                Text(cue.text)
                    .font(.fraunces(22, opticalSize: 36, soft: 50, wonk: 0))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Strata.Tokens.paper)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.55))
                    .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
                    .shadow(color: .black.opacity(0.8), radius: 6, x: 0, y: 1)
                    .padding(.bottom, 80)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
        .task(id: subtitleKey) { await reload() }
    }

    private var subtitleKey: String? {
        guard let idx = engine.activeSubtitleIndex,
              let itemId = engine.item?.id,
              let mediaSourceId = engine.plan?.mediaSourceId else { return nil }
        return "\(itemId)|\(mediaSourceId)|\(idx)"
    }

    private func reload() async {
        guard
            let key = subtitleKey,
            key != loadedKey,
            let images = engine.images,
            let idx = engine.activeSubtitleIndex,
            let itemId = engine.item?.id,
            let msId = engine.plan?.mediaSourceId,
            let url = images.subtitleVtt(itemId: itemId, mediaSourceId: msId, streamIndex: idx)
        else {
            if engine.activeSubtitleIndex == nil { cues = []; loadedKey = nil }
            return
        }
        loadedKey = key
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let text = String(data: data, encoding: .utf8) ?? ""
            let parsed = WebVTT.parse(text)
            await MainActor.run { self.cues = parsed }
        } catch {
            await MainActor.run { self.cues = [] }
        }
    }
}
