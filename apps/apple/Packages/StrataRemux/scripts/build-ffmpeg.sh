#!/usr/bin/env bash
# Builds the FFmpeg StrataRemux links against: one dynamic FFmpeg.framework per
# platform (iOS, iOS simulator, tvOS, tvOS simulator), bundled as
# Frameworks/FFmpeg.xcframework.
#
# LGPL-2.1 only: no --enable-gpl, --enable-version3 or --enable-nonfree, and nothing
# outside FFmpeg itself. Only what the remuxer needs: Matroska/MP4/AVI in, fragmented
# MP4 out, the Dolby Vision bitstream filter, DTS/TrueHD decoders, text and picture
# (PGS, VobSub, DVB) subtitle decoders, and lossless (FLAC/ALAC/PCM) or AAC encoders. Network I/O is the app's own (URLSession), so
# FFmpeg is built without networking or TLS.
#
# The HEVC decoder is there only for reading a file's media info (MediaProbe, and the
# HLS VIDEO-RANGE): FFmpeg's HEVC parser doesn't read the colour description in the SPS,
# so an MKV that signals HDR10 only in the bitstream read as SDR. With the decoder,
# avformat_find_stream_info opens it, which reads the SPS (VUI included) from the
# extradata and fills color_trc; no HEVC frames are decoded there. The AV1 parser reads
# colour itself, and MediaProbe reads H.264's SPS on its own (H264VUI.swift), so the
# H.264 decoder (which would decode several frames per file in that step) stays out.
#
# Usage: scripts/build-ffmpeg.sh            (FFMPEG_VERSION=9.0.2 by default)
set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-9.0.2}"
IOS_MIN=26.0
TVOS_MIN=26.0
MACOS_MIN=26.0
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HERE/.build-ffmpeg"
OUT="$HERE/Frameworks"
SRC="$WORK/ffmpeg-$FFMPEG_VERSION"
JOBS="$(sysctl -n hw.ncpu)"

mkdir -p "$WORK" "$OUT"
if [ ! -d "$SRC" ]; then
  curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" -o "$WORK/ffmpeg.tar.xz"
  tar -xf "$WORK/ffmpeg.tar.xz" -C "$WORK"
fi

COMPONENTS=(
  --disable-everything --disable-autodetect --disable-programs --disable-doc
  --disable-network --disable-avdevice --disable-avfilter --disable-swscale
  --disable-debug --enable-pic --enable-static --disable-shared
  --enable-avcodec --enable-avformat --enable-avutil --enable-swresample
  --enable-protocol=file
  --enable-demuxer=matroska --enable-demuxer=mov --enable-demuxer=avi
  --enable-muxer=mp4 --enable-muxer=mov
  --enable-parser=h264 --enable-parser=hevc --enable-parser=av1 --enable-parser=aac
  --enable-parser=ac3 --enable-parser=dca --enable-parser=mlp --enable-parser=flac
  --enable-parser=opus --enable-parser=vorbis
  --enable-decoder=hevc
  --enable-decoder=dca --enable-decoder=truehd --enable-decoder=mlp --enable-decoder=flac
  --enable-decoder=opus --enable-decoder=vorbis --enable-decoder=mp3 --enable-decoder=pcm_s16le
  --enable-decoder=pcm_s24le --enable-decoder=pcm_s32le
  --enable-decoder=subrip --enable-decoder=srt --enable-decoder=ass --enable-decoder=ssa
  --enable-decoder=webvtt --enable-decoder=movtext
  --enable-decoder=pgssub --enable-decoder=dvdsub --enable-decoder=dvbsub
  --enable-encoder=flac --enable-encoder=alac --enable-encoder=aac
  --enable-encoder=pcm_s16le --enable-encoder=pcm_s24le
  --enable-bsf=dovi_rpu --enable-bsf=dovi_split --enable-bsf=hevc_mp4toannexb --enable-bsf=h264_mp4toannexb
  --enable-bsf=extract_extradata --enable-bsf=aac_adtstoasc --enable-bsf=null
)

# name sdk arch min-flag
PLATFORMS=(
  "ios iphoneos arm64 -mios-version-min=$IOS_MIN"
  "ios-simulator iphonesimulator arm64 -mios-simulator-version-min=$IOS_MIN"
  "tvos appletvos arm64 -mtvos-version-min=$TVOS_MIN"
  "tvos-simulator appletvsimulator arm64 -mtvos-simulator-version-min=$TVOS_MIN"
  # For the package's unit tests (swift test runs on the Mac).
  "macos macosx arm64 -mmacosx-version-min=$MACOS_MIN"
)

FRAMEWORK_ARGS=()
for entry in "${PLATFORMS[@]}"; do
  read -r name sdk arch minflag <<<"$entry"
  sysroot="$(xcrun --sdk "$sdk" --show-sdk-path)"
  cc="$(xcrun --sdk "$sdk" -f clang)"
  build="$WORK/build-$name"
  prefix="$WORK/install-$name"
  rm -rf "$build" "$prefix" && mkdir -p "$build"
  echo "▸ FFmpeg $FFMPEG_VERSION for $name"
  (
    cd "$build"
    "$SRC/configure" --prefix="$prefix" --enable-cross-compile --target-os=darwin --arch=aarch64 \
      --cc="$cc" --sysroot="$sysroot" \
      --extra-cflags="-arch $arch $minflag" --extra-ldflags="-arch $arch $minflag" \
      "${COMPONENTS[@]}" >configure.log
    make -j"$JOBS" >make.log 2>&1
    make install >/dev/null
  )

  # One dynamic framework from the static libraries, so the app links FFmpeg
  # dynamically (LGPL) without four interdependent dylibs.
  fw="$WORK/frameworks-$name/FFmpeg.framework"
  rm -rf "$(dirname "$fw")" && mkdir -p "$fw/Headers" "$fw/Modules"
  "$cc" -dynamiclib -arch "$arch" $minflag -isysroot "$sysroot" \
    -install_name @rpath/FFmpeg.framework/FFmpeg \
    -Wl,-all_load "$prefix"/lib/libavformat.a "$prefix"/lib/libavcodec.a \
    "$prefix"/lib/libswresample.a "$prefix"/lib/libavutil.a \
    -lz -liconv -framework CoreFoundation -framework CoreMedia -framework CoreVideo \
    -framework VideoToolbox -framework AudioToolbox -framework Security \
    -o "$fw/FFmpeg"
  cp -R "$prefix"/include/* "$fw/Headers/"
  # FFmpeg's headers include each other as "libavutil/x.h"; inside a framework that only
  # resolves relative to the including header.
  find "$fw/Headers" -name '*.h' -exec sed -i '' -E 's#^(\#[[:space:]]*include[[:space:]]+")(lib(av|sw)[a-z]+/)#\1../\2#' {} +
  cat >"$fw/Modules/module.modulemap" <<'MAP'
framework module FFmpeg {
  umbrella header "FFmpeg.h"
  export *
  module * { export * }
  link "z"
}
MAP
  cat >"$fw/Headers/FFmpeg.h" <<'HDR'
#include "libavformat/avformat.h"
#include "libavformat/avio.h"
#include "libavcodec/avcodec.h"
#include "libavcodec/bsf.h"
#include "libavutil/avutil.h"
#include "libavutil/opt.h"
#include "libavutil/pixdesc.h"
#include "libavutil/dovi_meta.h"
#include "libavutil/channel_layout.h"
#include "libavutil/audio_fifo.h"
#include "libswresample/swresample.h"
HDR
  case "$sdk" in
    iphone*) platform_key=iPhoneOS; min=$IOS_MIN;;
    appletv*) platform_key=AppleTVOS; min=$TVOS_MIN;;
    *) platform_key=MacOSX; min=$MACOS_MIN;;
  esac
  cat >"$fw/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>FFmpeg</string>
  <key>CFBundleIdentifier</key><string>org.ffmpeg.FFmpeg</string>
  <key>CFBundleName</key><string>FFmpeg</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>$FFMPEG_VERSION</string>
  <key>CFBundleVersion</key><string>$FFMPEG_VERSION</string>
  <key>CFBundleSupportedPlatforms</key><array><string>$platform_key</string></array>
  <key>MinimumOSVersion</key><string>$min</string>
</dict></plist>
PLIST
  # Apple's required-reason APIs: libavformat's file protocol references fstat/lstat
  # (file sizes; only files in the app's own container are ever opened). No data collected.
  cat >"$fw/PrivacyInfo.xcprivacy" <<'PRIVACY'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>NSPrivacyTracking</key><false/>
  <key>NSPrivacyTrackingDomains</key><array/>
  <key>NSPrivacyCollectedDataTypes</key><array/>
  <key>NSPrivacyAccessedAPITypes</key><array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array>
    </dict>
  </array>
</dict></plist>
PRIVACY
  FRAMEWORK_ARGS+=(-framework "$fw")
done

rm -rf "$OUT/FFmpeg.xcframework"
xcodebuild -create-xcframework "${FRAMEWORK_ARGS[@]}" -output "$OUT/FFmpeg.xcframework" >/dev/null
echo "✓ $OUT/FFmpeg.xcframework"
