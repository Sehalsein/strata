// Fails fast when App Store Connect won't take builds of this version.
//
// Once Apple approves a version, its train closes: an upload of it is accepted, then rejected
// during processing (ITMS 90186 / 90062), and the upload action waits ~40 minutes before
// timing out without saying why. This asks App Store Connect first, before the build.
//
//   swift check-version-open.swift <marketing version>
//   env: APPSTORE_ISSUER_ID, APPSTORE_API_KEY_ID, APPSTORE_API_PRIVATE_KEY, APPSTORE_APP_ID
//
// Exits 1 only on a definite answer: an approved version at or above <marketing version>.
// If App Store Connect can't be asked (network, auth), it warns and exits 0, so a hiccup
// here never blocks a release.
//
//   swift check-version-open.swift --fixture <response.json> <marketing version>
//
// reads a saved API response instead, for local tests. It's a flag rather than an environment
// variable so only the reviewed command line can turn it on; the workflow never passes it.

import CryptoKit
import Foundation

let env = ProcessInfo.processInfo.environment

func warnAndPass(_ message: String) -> Never {
    print("::warning::Version check skipped: \(message)")
    exit(0)
}

var args = Array(CommandLine.arguments.dropFirst())
var fixture: String?
if args.first == "--fixture", args.count >= 2 {
    fixture = args[1]
    args.removeFirst(2)
}
guard args.count == 1 else {
    print("usage: check-version-open.swift [--fixture <response.json>] <marketing version>")
    exit(2)
}
let version = args[0]

/// "0.5.1" → [0, 5, 1]; compares by number, so 0.10.0 > 0.9.0.
func parts(_ v: String) -> [Int] {
    var p = v.split(separator: ".").map { Int($0) ?? 0 }
    while p.count < 3 { p.append(0) }
    return p
}
func atLeast(_ a: String, _ b: String) -> Bool { !parts(a).lexicographicallyPrecedes(parts(b)) }

/// States after Apple's approval. A version in any of them takes no more builds.
let approved: Set<String> = [
    "ACCEPTED", "PENDING_APPLE_RELEASE", "PENDING_DEVELOPER_RELEASE",
    "PROCESSING_FOR_APP_STORE", "PROCESSING_FOR_DISTRIBUTION",
    "READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION",
    "DEVELOPER_REMOVED_FROM_SALE", "REMOVED_FROM_SALE",
]

func base64url(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func fetchVersions() async -> Data {
    if let fixture {
        guard let data = FileManager.default.contents(atPath: fixture) else { warnAndPass("can't read the fixture") }
        return data
    }
    guard let issuer = env["APPSTORE_ISSUER_ID"], !issuer.isEmpty,
          let keyId = env["APPSTORE_API_KEY_ID"], !keyId.isEmpty,
          let pem = env["APPSTORE_API_PRIVATE_KEY"], !pem.isEmpty,
          let appId = env["APPSTORE_APP_ID"], !appId.isEmpty
    else { warnAndPass("App Store Connect credentials or app id missing") }

    // App Store Connect API token: ES256 JWT, valid for 10 minutes.
    let now = Int(Date().timeIntervalSince1970)
    let header = #"{"alg":"ES256","kid":"\#(keyId)","typ":"JWT"}"#
    let claims = #"{"iss":"\#(issuer)","iat":\#(now),"exp":\#(now + 600),"aud":"appstoreconnect-v1"}"#
    let signingInput = base64url(Data(header.utf8)) + "." + base64url(Data(claims.utf8))
    let token: String
    do {
        let key = try P256.Signing.PrivateKey(pemRepresentation: pem)
        let signature = try key.signature(for: Data(signingInput.utf8))
        token = signingInput + "." + base64url(signature.rawRepresentation)
    } catch {
        // No error detail: the only input here is the secret itself.
        warnAndPass("couldn't read the App Store Connect API private key")
    }

    var url = URLComponents(string: "https://api.appstoreconnect.apple.com/v1/apps/\(appId)/appStoreVersions")!
    url.queryItems = [
        URLQueryItem(name: "limit", value: "200"),
        URLQueryItem(name: "fields[appStoreVersions]", value: "versionString,platform,appStoreState,appVersionState"),
    ]
    var request = URLRequest(url: url.url!, timeoutInterval: 30)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { warnAndPass("App Store Connect answered HTTP \(status)") }
        return data
    } catch {
        warnAndPass("couldn't reach App Store Connect (\(error.localizedDescription))")
    }
}

struct Response: Decodable {
    struct Item: Decodable {
        struct Attributes: Decodable {
            var versionString: String?
            var platform: String?
            var appStoreState: String?
            var appVersionState: String?
        }
        var attributes: Attributes
    }
    var data: [Item]
}

let body = await fetchVersions()
guard let versions = try? JSONDecoder().decode(Response.self, from: body).data.map(\.attributes) else {
    warnAndPass("unexpected response from App Store Connect")
}

print("App Store versions:")
var blocking: [String] = []
for v in versions {
    let name = v.versionString ?? "?"
    let state = v.appVersionState ?? v.appStoreState ?? "?"
    let isApproved = approved.contains(state) || approved.contains(v.appStoreState ?? "")
    print("  \(v.platform ?? "?") \(name): \(state)\(isApproved ? " (approved)" : "")")
    if isApproved, let s = v.versionString, atLeast(s, version) {
        blocking.append("\(v.platform ?? "?") \(s) (\(state))")
    }
}

if blocking.isEmpty {
    print("\(version) is open for new builds.")
    exit(0)
}
print("::error::Version \(version) is closed for new TestFlight builds: App Store Connect already approved \(blocking.joined(separator: ", ")). Bump MARKETING_VERSION in apps/apple/project.yml above it.")
exit(1)
