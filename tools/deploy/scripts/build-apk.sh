#!/usr/bin/env bash
# Build the Android TV debug APK and copy into OUT_DIR for Downloader install.
#
# Debug build uses ~/.android/debug.keystore (stable per-machine), so subsequent
# updates install in-place over the previous version without uninstall.
#
# Environment:
#   OUT_DIR   - absolute path to deploy directory (required)
#   BASE_URL  - URL prefix devices fetch from (required)

set -euo pipefail

: "${OUT_DIR:?OUT_DIR not set; run via 'make android'}"
: "${BASE_URL:?BASE_URL not set; run via 'make android'}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TV_DIR="$REPO_ROOT/apps/tv-android"

cd "$TV_DIR"

# ---- preconditions ---------------------------------------------------------

if [[ ! -x "./gradlew" ]]; then
  if command -v gradle >/dev/null; then
    echo "==> bootstrapping Gradle wrapper"
    gradle wrapper --gradle-version 8.10 --quiet
  else
    echo "error: no ./gradlew and no system 'gradle' found." >&2
    echo "       brew install gradle, then re-run." >&2
    exit 1
  fi
fi

# ---- read version metadata -------------------------------------------------

VERSION="$(awk -F'"' '/versionName *=/ {print $2; exit}' app/build.gradle.kts)"
[[ -n "$VERSION" ]] || { echo "error: could not read versionName from app/build.gradle.kts" >&2; exit 1; }

BUILD="$(date +%Y%m%d%H%M)"
echo "==> Strata TV $VERSION (build $BUILD)"

# ---- build ----------------------------------------------------------------

echo "==> gradlew :app:assembleDebug"
./gradlew :app:assembleDebug --console=plain --quiet

APK_SRC="app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$APK_SRC" ]] || { echo "error: built APK missing at $APK_SRC" >&2; exit 1; }

# ---- copy + update landing -------------------------------------------------

APK_NAME="Strata-tv-${VERSION}-${BUILD}.apk"
mkdir -p "$OUT_DIR"
cp "$APK_SRC" "$OUT_DIR/$APK_NAME"
cp "$APK_SRC" "$OUT_DIR/Strata-tv-latest.apk"

bash "$(dirname "$0")/_write-index.sh"

APK_SIZE_MB="$(( $(stat -f%z "$OUT_DIR/$APK_NAME") / 1048576 ))"

echo
echo "Done."
echo "  APK            : $OUT_DIR/$APK_NAME (${APK_SIZE_MB} MB)"
echo "  Downloader URL : $BASE_URL/tv"
echo
echo "Next:"
echo "  1. Run 'make serve' in tools/deploy to host the files."
echo "  2. On the TV, install 'Downloader' from the Play Store (free)."
echo "  3. In Downloader, enter: $BASE_URL/tv"
echo "     Tap Go -> Install. Subsequent updates: same URL -> Go."
