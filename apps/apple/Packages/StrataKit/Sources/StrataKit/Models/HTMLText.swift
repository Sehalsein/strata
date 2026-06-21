import Foundation

public extension String {
    /// Converts the lightweight HTML that Jellyfin embeds in overviews/taglines
    /// into clean, wrappable plain text. Jellyfin descriptions routinely contain
    /// `<br>` line breaks, the odd `<i>`/`<b>`/`<p>` tag, and HTML entities like
    /// `&amp;` — rendered verbatim they leak markup into the UI and the long,
    /// unbroken `<br>` runs can force horizontal overflow.
    ///
    /// This is deliberately a synchronous, regex-light pass rather than
    /// `NSAttributedString(data:)` HTML import, which is main-thread-only and
    /// far too heavy for a detail-screen string.
    func strippingHTML() -> String {
        guard contains("<") || contains("&") else { return self }

        var s = self

        // Block/line-break tags become real newlines so paragraphs survive.
        let breaks = ["<br>", "<br/>", "<br />", "</p>", "</P>", "<BR>", "<BR/>", "<BR />"]
        for tag in breaks {
            s = s.replacingOccurrences(of: tag, with: "\n")
        }

        // Drop every remaining tag (<i>, <b>, <p>, <a ...>, …).
        s = s.replacingOccurrences(
            of: "<[^>]+>",
            with: "",
            options: .regularExpression
        )

        // Decode the handful of entities Jellyfin actually emits.
        let entities: [String: String] = [
            "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&quot;": "\"", "&#39;": "'", "&apos;": "'",
            "&nbsp;": " ", "&hellip;": "…", "&mdash;": "—", "&ndash;": "–",
        ]
        for (entity, value) in entities {
            s = s.replacingOccurrences(of: entity, with: value)
        }

        // Numeric entities, e.g. &#8217; → ’.
        s = s.decodingNumericEntities()

        // Collapse the whitespace the markup leaves behind: trim each line,
        // drop trailing spaces, and cap runs of blank lines at one.
        let lines = s.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
        var cleaned: [String] = []
        for line in lines {
            if line.isEmpty && cleaned.last == "" { continue }
            cleaned.append(line)
        }
        return cleaned.joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Resolves decimal (`&#8217;`) and hex (`&#x2019;`) character references.
    private func decodingNumericEntities() -> String {
        guard contains("&#") else { return self }
        var result = ""
        var rest = Substring(self)
        while let amp = rest.range(of: "&#") {
            result += rest[..<amp.lowerBound]
            let after = rest[amp.upperBound...]
            guard let semi = after.firstIndex(of: ";") else {
                result += rest[amp.lowerBound...]
                rest = Substring("")
                break
            }
            let body = after[..<semi]
            let scalarValue: UInt32?
            if let first = body.first, first == "x" || first == "X" {
                scalarValue = UInt32(body.dropFirst(), radix: 16)
            } else {
                scalarValue = UInt32(body, radix: 10)
            }
            if let value = scalarValue, let scalar = Unicode.Scalar(value) {
                result.append(Character(scalar))
            } else {
                result += rest[amp.lowerBound...after.index(after: semi)]
            }
            rest = after[after.index(after: semi)...]
        }
        result += rest
        return result
    }
}
