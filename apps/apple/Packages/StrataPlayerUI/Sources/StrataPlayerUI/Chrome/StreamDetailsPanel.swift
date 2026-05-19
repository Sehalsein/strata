import SwiftUI
import StrataKit
import StrataDesign

public struct StreamDetailsPanel: View {
    public let plan: StreamPlan?
    public let item: BaseItem?

    public init(plan: StreamPlan?, item: BaseItem?) {
        self.plan = plan
        self.item = item
    }

    public var body: some View {
        GlassPanel(strong: true) {
            VStack(alignment: .leading, spacing: 12) {
                Text("STREAM DETAILS").strataSpec()
                Group {
                    row("MODE", plan?.preferHLS == true ? "HLS Transcode" : "Direct Play")
                    row("CONTAINER", plan?.container?.uppercased() ?? "—")
                    row("VIDEO", plan?.videoCodec?.uppercased() ?? "—")
                    row("AUDIO", plan?.audioCodec?.uppercased() ?? "—")
                    row("BITRATE", plan?.bitrate.map { "\(Int($0/1000)) kbps" } ?? "—")
                    if let session = plan?.playSessionId, !session.isEmpty {
                        row("SESSION", String(session.prefix(8)).uppercased())
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: 360, alignment: .leading)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.mono(10)).tracking(1.5).foregroundStyle(Strata.Tokens.paperDim)
            Spacer()
            Text(value).font(.mono(11)).foregroundStyle(Strata.Tokens.paper)
        }
    }
}
