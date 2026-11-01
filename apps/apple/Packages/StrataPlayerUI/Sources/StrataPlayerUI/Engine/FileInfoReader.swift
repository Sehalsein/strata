import Foundation
import StrataKit
import StrataRemux

/// Reads a file's media info from its link and sends it to the server, which can't read
/// files itself (it answers 428 `needsProbe` until it has it). Used before a download.
public enum FileInfoReader {
    public static func report(fileId: Int, url: URL, client: StrataClient) async throws {
        let info = try await MediaProbe.probe(url: url)
        try await client.reportProbe(fileId: fileId, info: info)
    }
}
