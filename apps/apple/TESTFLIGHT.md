# TestFlight delivery

[![Apple CI](https://github.com/Sehalsein/strata/actions/workflows/apple-ci.yml/badge.svg)](https://github.com/Sehalsein/strata/actions/workflows/apple-ci.yml)

GitHub Actions builds and uploads two artifacts from the shared `Strata` target:

- iOS/iPadOS, including the `StrataWidgets` extension
- tvOS

The workflow intentionally stops at TestFlight. It does not submit a build for App Review or automatically add external tester groups.

## 1. Apple setup

An active Apple Developer Program membership is required.

In Certificates, Identifiers & Profiles, register the explicit bundle IDs below and create the listed App Store distribution profiles. Profile names must match exactly because the Release build and export configuration refer to them by name.

| Platform | Bundle ID | Profile type | Required profile name |
|---|---|---|---|
| iOS/iPadOS | `com.sehalsein.strata` | iOS App Store | `AppStore com.sehalsein.strata` |
| iOS/iPadOS widget | `com.sehalsein.strata.widgets` | iOS App Store | `AppStore com.sehalsein.strata.widgets` |
| tvOS | `com.sehalsein.strata` | tvOS App Store | `AppStore tvOS com.sehalsein.strata` |

The two bundle IDs above are registered to the Apple Developer team used for Strata.

Create an Apple Distribution certificate and export the certificate together with its private key from Keychain Access as a password-protected `.p12` file.

In App Store Connect:

1. Create the `Strata TV` app record for bundle ID `com.sehalsein.strata` and enable both iOS and tvOS platforms. The installed display name remains `Strata`.
2. Under Users and Access -> Integrations -> App Store Connect API, create a team API key with the App Manager role and download its `AuthKey_<KEY_ID>.p8` file. Apple only offers the private key download once.
3. Complete any current agreements, age-rating questions, app privacy information, and TestFlight test information. tvOS also requires Apple TV privacy-policy text before store submission.

## 2. GitHub configuration

Open the repository's Settings -> Secrets and variables -> Actions.

Add these variables:

| Variable | Value |
|---|---|
| `APPSTORE_TEAM_ID` | The 10-character Apple Developer Team ID |
| `APPSTORE_ISSUER_ID` | The App Store Connect API Issuer ID |
| `APPSTORE_API_KEY_ID` | The API key's Key ID |

Add these secrets:

| Secret | Value |
|---|---|
| `APPSTORE_API_PRIVATE_KEY` | The complete text of `AuthKey_<KEY_ID>.p8` |
| `APPSTORE_CERTIFICATES_FILE_BASE64` | Base64-encoded Apple Distribution `.p12` |
| `APPSTORE_CERTIFICATES_PASSWORD` | The `.p12` export password |

On macOS, copy the `.p12` value with:

```sh
base64 -i AppleDistribution.p12 | pbcopy
```

Keep all key and certificate files outside the repository.

## 3. Upload builds

For a versioned upload, tag the commit. The version is taken from the tag:

```sh
git tag apple-v0.1.0
git push origin apple-v0.1.0
```

Alternatively, open Actions -> Apple TestFlight -> Run workflow and optionally enter a marketing version. If omitted, the workflow reads `MARKETING_VERSION` from `project.yml`.

GitHub assigns build numbers as `<workflow run>.<attempt>`, so rerunning a failed upload gets a new App Store Connect build number. iOS/iPadOS and tvOS upload in parallel and appear as separate platform builds under the same app record.

Normal pushes and pull requests that touch `apps/apple` run unsigned iOS/iPadOS and tvOS smoke builds in `Apple CI`; they never receive signing credentials.

## Fonts

The font binaries under `Resources/Fonts` remain intentionally untracked. A GitHub-hosted build succeeds without them and uses the system font fallbacks described in `Resources/Fonts/README.md`. If the custom typography must ship in TestFlight, add the licensed font files to the repository or add a secure CI restoration step before `xcodegen generate`.
