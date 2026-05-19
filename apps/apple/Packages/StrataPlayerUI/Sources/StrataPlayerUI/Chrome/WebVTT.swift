import Foundation

public struct VTTCue: Equatable, Sendable {
    public let start: TimeInterval
    public let end: TimeInterval
    public let text: String
}

/// Minimal WebVTT parser. Handles WEBVTT header, cue timings, and multi-line
/// cue text. Strips inline styling tags (`<c.colorname>`, `<i>`, `<b>`,
/// `<u>`, voice tags `<v Speaker>`).
public enum WebVTT {
    public static func parse(_ source: String) -> [VTTCue] {
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var lines = normalized.components(separatedBy: "\n")
        if let first = lines.first, first.hasPrefix("WEBVTT") { lines.removeFirst() }

        var cues: [VTTCue] = []
        var i = 0
        while i < lines.count {
            let line = lines[i].trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("NOTE") || line.hasPrefix("STYLE") || line.hasPrefix("REGION") {
                i += 1; continue
            }
            // Optional cue identifier
            var timingLineIndex = i
            if !line.contains("-->") {
                timingLineIndex = i + 1
                if timingLineIndex >= lines.count { break }
            }
            let timing = lines[timingLineIndex].trimmingCharacters(in: .whitespaces)
            guard let (start, end) = parseTiming(timing) else {
                i = timingLineIndex + 1; continue
            }
            var textLines: [String] = []
            var j = timingLineIndex + 1
            while j < lines.count {
                let t = lines[j]
                if t.trimmingCharacters(in: .whitespaces).isEmpty { break }
                textLines.append(t)
                j += 1
            }
            let text = stripTags(textLines.joined(separator: "\n"))
            cues.append(VTTCue(start: start, end: end, text: text))
            i = j + 1
        }
        return cues
    }

    private static func parseTiming(_ line: String) -> (TimeInterval, TimeInterval)? {
        guard let arrow = line.range(of: "-->") else { return nil }
        let lhs = line[..<arrow.lowerBound].trimmingCharacters(in: .whitespaces)
        let rhs = line[arrow.upperBound...].trimmingCharacters(in: .whitespaces)
        let endTokens = rhs.split(separator: " ").map(String.init)
        guard let startSec = seconds(from: lhs), !endTokens.isEmpty,
              let endSec = seconds(from: endTokens[0]) else { return nil }
        return (startSec, endSec)
    }

    private static func seconds(from token: String) -> TimeInterval? {
        let parts = token.split(separator: ":").map(String.init)
        guard !parts.isEmpty else { return nil }
        let secsPart = parts.last!.replacingOccurrences(of: ",", with: ".")
        guard let secs = Double(secsPart) else { return nil }
        var total = secs
        if parts.count >= 2, let minutes = Double(parts[parts.count - 2]) { total += minutes * 60 }
        if parts.count >= 3, let hours = Double(parts[parts.count - 3]) { total += hours * 3600 }
        return total
    }

    private static func stripTags(_ s: String) -> String {
        var out = ""
        var inTag = false
        for ch in s {
            if ch == "<" { inTag = true; continue }
            if ch == ">" { inTag = false; continue }
            if !inTag { out.append(ch) }
        }
        return out
    }
}
