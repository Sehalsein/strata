#!/usr/bin/env bash
# Build an unsigned IPA for AltStore sideload and update source.json.
#
# Environment:
#   OUT_DIR   - absolute path where the IPA + source.json land (required)
#   BASE_URL  - URL prefix devices will fetch from (required, e.g. http://192.168.1.5:8080)

set -euo pipefail

: "${OUT_DIR:?OUT_DIR not set; run via 'make ios'}"
: "${BASE_URL:?BASE_URL not set; run via 'make ios'}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APPLE_DIR="$REPO_ROOT/apps/apple"

# ---- preconditions --------------------------------------------------------

command -v xcodegen >/dev/null || {
  echo "error: xcodegen not found. Install with: brew install xcodegen" >&2
  exit 1
}
command -v xcodebuild >/dev/null || {
  echo "error: xcodebuild not found. Install Xcode + command line tools." >&2
  exit 1
}

# ---- regenerate project ---------------------------------------------------

cd "$APPLE_DIR"
echo "==> xcodegen generate"
xcodegen generate --quiet

# ---- read version metadata -------------------------------------------------

VERSION="$(awk -F'"' '/MARKETING_VERSION:/ {print $2; exit}' project.yml)"
[[ -n "$VERSION" ]] || { echo "error: could not read MARKETING_VERSION from project.yml" >&2; exit 1; }

BUILD="$(date +%Y%m%d%H%M)"
DATE_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "==> Strata $VERSION (build $BUILD)"

# ---- archive (unsigned) ---------------------------------------------------

ARCHIVE_DIR="build/sideload"
ARCHIVE_PATH="$ARCHIVE_DIR/Strata.xcarchive"
rm -rf "$ARCHIVE_DIR"
mkdir -p "$ARCHIVE_DIR"

echo "==> xcodebuild archive (unsigned)"
xcodebuild \
  -project Strata.xcodeproj \
  -scheme Strata \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -quiet \
  CURRENT_PROJECT_VERSION="$BUILD" \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  DEVELOPMENT_TEAM="" \
  archive

APP_PATH="$ARCHIVE_PATH/Products/Applications/Strata.app"
[[ -d "$APP_PATH" ]] || { echo "error: Strata.app missing in archive at $APP_PATH" >&2; exit 1; }

# ---- package into .ipa ----------------------------------------------------

PAYLOAD_DIR="$ARCHIVE_DIR/Payload"
rm -rf "$PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR"
cp -R "$APP_PATH" "$PAYLOAD_DIR/"

# Free Apple IDs can't sign Live Activity / WidgetKit extensions. Strip them
# so AltStore's re-signer doesn't choke. The main app still launches; the
# widget just won't appear on lock screen / Dynamic Island.
if [[ -d "$PAYLOAD_DIR/Strata.app/PlugIns" ]]; then
  echo "==> stripping PlugIns (widget extension)"
  rm -rf "$PAYLOAD_DIR/Strata.app/PlugIns"
fi

# Strip leftover Swift support / symbols that are pointless for sideload.
rm -rf "$PAYLOAD_DIR/Strata.app/_CodeSignature"

IPA_NAME="Strata-${VERSION}-${BUILD}.ipa"
IPA_PATH="$ARCHIVE_DIR/$IPA_NAME"

echo "==> zip -> $IPA_NAME"
(cd "$ARCHIVE_DIR" && zip -qr "$IPA_NAME" Payload)

# ---- copy into deploy dir + write source.json ------------------------------

mkdir -p "$OUT_DIR"
cp "$IPA_PATH" "$OUT_DIR/"

# Maintain a stable "latest" alias so the source.json downloadURL never breaks
# even if you regenerate with a different version string.
cp "$IPA_PATH" "$OUT_DIR/Strata-latest.ipa"

IPA_SIZE_BYTES="$(stat -f%z "$IPA_PATH")"

SOURCE_JSON="$OUT_DIR/source.json"

# Append-and-rewrite source.json. Previous entries (if any) are preserved
# under "versions" so AltStore's "previous versions" picker keeps history.
python3 - "$SOURCE_JSON" <<PY
import json, os, sys
from pathlib import Path

path = Path(sys.argv[1])
base_url = os.environ["BASE_URL"]
version = "$VERSION"
build = "$BUILD"
date_utc = "$DATE_UTC"
size = $IPA_SIZE_BYTES
ipa_name = "$IPA_NAME"

# Load existing source (preserve history) or start fresh.
if path.exists():
    src = json.loads(path.read_text())
else:
    src = {
        "name": "Strata (personal)",
        "identifier": "com.strata.client.source",
        "subtitle": "Personal Jellyfin client builds",
        "description": "Sideload Strata to iPhone and iPad via AltStore.",
        "iconURL": "",
        "tintColor": "1A1A1A",
        "apps": [],
        "news": [],
    }

# Ensure the Strata app entry exists.
app = None
for a in src.get("apps", []):
    if a.get("bundleIdentifier") == "com.strata.client":
        app = a
        break
if app is None:
    app = {
        "name": "Strata",
        "bundleIdentifier": "com.strata.client",
        "developerName": "Personal Build",
        "subtitle": "Native Jellyfin client",
        "localizedDescription": "Cinematheque-styled native Jellyfin client.",
        "iconURL": "",
        "tintColor": "1A1A1A",
        "category": "entertainment",
        "screenshotURLs": [],
        "versions": [],
    }
    src.setdefault("apps", []).append(app)

new_version = {
    "version": version,
    "buildVersion": build,
    "date": date_utc,
    "size": size,
    "downloadURL": f"{base_url}/{ipa_name}",
    "localizedDescription": f"Build {build} ({date_utc}).",
    "minOSVersion": "17.0",
}

# Drop any prior entry with same (version, build) to avoid duplicates.
versions = [
    v for v in app.get("versions", [])
    if not (v.get("version") == version and v.get("buildVersion") == build)
]
versions.insert(0, new_version)
app["versions"] = versions[:20]  # keep last 20 builds in history

# Keep flat keys mirrored to the latest entry for older AltStore clients.
app["version"] = version
app["versionDate"] = date_utc
app["versionDescription"] = new_version["localizedDescription"]
app["downloadURL"] = new_version["downloadURL"]
app["size"] = size

path.write_text(json.dumps(src, indent=2) + "\n")
print(f"==> source.json updated ({len(app['versions'])} versions in history)")
PY

# Always (re)write a tiny landing page so devices have something human-friendly.
bash "$(dirname "$0")/_write-index.sh"

echo
echo "Done."
echo "  IPA            : $OUT_DIR/$IPA_NAME"
echo "  AltStore source: $BASE_URL/source.json"
echo
echo "Next:"
echo "  1. Run 'make serve' in tools/deploy to host the files."
echo "  2. On each device, AltStore -> Browse -> Sources -> + and paste:"
echo "       $BASE_URL/source.json"
echo "  3. AltStore -> Updates -> tap Update on Strata."
