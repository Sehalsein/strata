#!/usr/bin/env bash
# Build the Strata Android TV app and deploy it to a device (your TV by default).
#
# Usage:
#   ./run-on-tv.sh                 # build + install + launch on the default TV
#   ./run-on-tv.sh --no-build      # skip the Gradle build, just install the last APK
#   ./run-on-tv.sh -s emulator-5554  # target a different device (e.g. the emulator)
#   TV=192.168.2.50:5555 ./run-on-tv.sh   # override the TV address
#
# Requires: adb, JDK 17, Android SDK. The TV must have ADB-over-network enabled
# and be on the same LAN (Settings > Developer options > Network debugging).

set -euo pipefail

# --- config (override via env) ---
TV="${TV:-192.168.2.103:5555}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$PATH:$ANDROID_HOME/platform-tools"

PKG="com.strata.tv"
APK="app/build/outputs/apk/debug/app-debug.apk"
BUILD=1
TARGET="$TV"

# --- args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) BUILD=0; shift ;;
    -s) TARGET="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

# --- connect to the TV (no-op if already connected or if it's an emulator) ---
if [[ "$TARGET" == *:* ]]; then
  echo "→ connecting to $TARGET ..."
  adb connect "$TARGET" >/dev/null || true
fi

if ! adb devices | grep -q "^$TARGET[[:space:]]*device$"; then
  echo "✗ $TARGET is not connected. On the TV: Settings > Developer options > Network debugging." >&2
  echo "  Devices currently visible:" >&2
  adb devices -l >&2
  exit 1
fi

# --- build ---
if [[ "$BUILD" -eq 1 ]]; then
  echo "→ building debug APK ..."
  ./gradlew :app:assembleDebug --console=plain
fi

# --- install + launch ---
echo "→ installing on $TARGET ..."
adb -s "$TARGET" install -r "$APK"

echo "→ launching ..."
adb -s "$TARGET" shell am force-stop "$PKG"
adb -s "$TARGET" shell monkey -p "$PKG" -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1

echo "✓ Strata is running on $TARGET"
