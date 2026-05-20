#!/usr/bin/env bash
# Generate out/index.html — a tiny landing page reflecting whatever artifacts
# currently exist in OUT_DIR. Called by both build-ipa.sh and build-apk.sh.

set -euo pipefail

: "${OUT_DIR:?OUT_DIR not set}"
: "${BASE_URL:?BASE_URL not set}"

HAS_IPA="no"; HAS_APK="no"
LATEST_IPA=""; LATEST_APK=""

# Prefer the versioned filename over the -latest alias for display, but fall
# back to whatever exists if only the alias is present.
_newest() {
  local pattern="$1"
  local found
  found="$(ls -t $pattern 2>/dev/null | grep -v -- '-latest\.' | head -1)"
  [[ -z "$found" ]] && found="$(ls -t $pattern 2>/dev/null | head -1)"
  [[ -n "$found" ]] && basename "$found"
}

if compgen -G "$OUT_DIR/Strata-*.ipa" > /dev/null; then
  HAS_IPA="yes"
  LATEST_IPA="$(_newest "$OUT_DIR/Strata-*.ipa")"
fi
if compgen -G "$OUT_DIR/Strata-tv-*.apk" > /dev/null; then
  HAS_APK="yes"
  LATEST_APK="$(_newest "$OUT_DIR/Strata-tv-*.apk")"
fi

cat > "$OUT_DIR/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Strata - Personal Builds</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           max-width: 640px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    h1 { font-weight: 600; letter-spacing: -0.02em; }
    section { border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
              border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; }
    code { background: color-mix(in srgb, currentColor 10%, transparent);
           padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; }
    a.btn { display: inline-block; padding: 0.5rem 0.9rem;
            background: #1A1A1A; color: white; border-radius: 8px;
            text-decoration: none; font-weight: 500; }
    .muted { opacity: 0.6; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Strata - Personal Builds</h1>
  <p class="muted">Served from <code>${BASE_URL}</code></p>

  <section>
    <h2>iPhone / iPad (AltStore)</h2>
HTML

if [[ "$HAS_IPA" == "yes" ]]; then
  cat >> "$OUT_DIR/index.html" <<HTML
    <p>In AltStore on your device: <strong>Browse -> Sources -> +</strong> and paste:</p>
    <p><code>${BASE_URL}/source.json</code></p>
    <p>Already subscribed? Open the <strong>Updates</strong> tab.</p>
    <p class="muted">Latest IPA: <a href="${LATEST_IPA}">${LATEST_IPA}</a></p>
HTML
else
  cat >> "$OUT_DIR/index.html" <<HTML
    <p class="muted">No IPA built yet. Run <code>make ios</code>.</p>
HTML
fi

cat >> "$OUT_DIR/index.html" <<HTML
  </section>

  <section>
    <h2>Android TV (Downloader app)</h2>
HTML

if [[ "$HAS_APK" == "yes" ]]; then
  cat >> "$OUT_DIR/index.html" <<HTML
    <p>In the <strong>Downloader</strong> app on your TV, enter:</p>
    <p><code>${BASE_URL}/tv</code></p>
    <p>Or direct link: <a href="${LATEST_APK}">${LATEST_APK}</a></p>
HTML
else
  cat >> "$OUT_DIR/index.html" <<HTML
    <p class="muted">No APK built yet. Run <code>make android</code>.</p>
HTML
fi

cat >> "$OUT_DIR/index.html" <<HTML
  </section>
</body>
</html>
HTML

# Also write a short alias file so 'BASE_URL/tv' on a TV remote downloads
# the latest APK directly. python3 -m http.server doesn't do redirects,
# so we just symlink the file.
if [[ "$HAS_APK" == "yes" ]]; then
  ln -sf "$LATEST_APK" "$OUT_DIR/tv"
fi
