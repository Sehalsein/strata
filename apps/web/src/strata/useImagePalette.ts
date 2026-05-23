import { useEffect, useState } from "react";
import { Vibrant } from "node-vibrant/browser";
import type { Palette } from "./theme";

const cache = new Map<string, Palette>();
const inflight = new Map<string, Promise<Palette | null>>();

const FALLBACK_C1 = "#2a1a10";
const FALLBACK_C2 = "#0c0a08";
const FALLBACK_C3 = "#e8b341";

const pickHex = (
  ...swatches: Array<{ hex: string } | null | undefined>
): string | null => {
  for (const s of swatches) if (s?.hex) return s.hex;
  return null;
};

/**
 * Non-hook accessor — returns a cached palette synchronously when available,
 * otherwise kicks off (or joins) a Vibrant extraction and resolves with the
 * palette (or null on failure). Safe to call from event handlers.
 */
export const getImagePalette = (
  url: string | null,
): { cached: Palette | null; promise: Promise<Palette | null> } => {
  if (!url) return { cached: null, promise: Promise.resolve(null) };
  const hit = cache.get(url);
  if (hit) return { cached: hit, promise: Promise.resolve(hit) };
  let promise = inflight.get(url);
  if (!promise) {
    promise = Vibrant.from(url)
      .getPalette()
      .then((p) => {
        const c1 =
          pickHex(p.Vibrant, p.Muted, p.DarkVibrant, p.LightVibrant) ??
          FALLBACK_C1;
        const c2 =
          pickHex(p.DarkMuted, p.DarkVibrant, p.Muted) ?? FALLBACK_C2;
        const c3 =
          pickHex(p.LightVibrant, p.LightMuted, p.Vibrant) ?? FALLBACK_C3;
        const out: Palette = [c1, c2, c3];
        cache.set(url, out);
        inflight.delete(url);
        return out;
      })
      .catch(() => {
        inflight.delete(url);
        return null;
      });
    inflight.set(url, promise);
  }
  return { cached: null, promise };
};

export const useImagePalette = (url: string | null): Palette | null => {
  const [palette, setPalette] = useState<Palette | null>(() =>
    url ? (cache.get(url) ?? null) : null,
  );

  useEffect(() => {
    if (!url) {
      setPalette(null);
      return;
    }
    const { cached, promise } = getImagePalette(url);
    if (cached) {
      setPalette(cached);
      return;
    }
    setPalette(null);
    let cancelled = false;
    promise.then((p) => {
      if (!cancelled) setPalette(p);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return palette;
};
