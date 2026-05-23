import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Palette } from "./theme";
import { getImagePalette } from "./useImagePalette";

type AmbientCtx = {
  // Live palette key — drives the current backdrop. May be a hover preview.
  paletteKey: string | null;
  setPaletteKey: (key: string | null) => void;
  // Source-of-truth palette key for the current page (no preview).
  // Hover-leave restores from this.
  basePaletteKey: string | null;
  setBasePaletteKey: (key: string | null) => void;
  // Optional palette override (e.g. extracted from a cover image). When set,
  // AppShell uses these colors instead of the hash-derived paletteFor(key).
  paletteOverride: Palette | null;
  setPaletteOverride: (p: Palette | null) => void;
  intensity: number;
  setIntensity: (n: number) => void;
};

const Ctx = createContext<AmbientCtx>({
  paletteKey: null,
  setPaletteKey: () => {},
  basePaletteKey: null,
  setBasePaletteKey: () => {},
  paletteOverride: null,
  setPaletteOverride: () => {},
  intensity: 0.85,
  setIntensity: () => {},
});

export const AmbientProvider = ({ children }: { children: ReactNode }) => {
  const [paletteKey, setPaletteKey] = useState<string | null>(null);
  const [basePaletteKey, setBasePaletteKey] = useState<string | null>(null);
  const [paletteOverride, setPaletteOverride] = useState<Palette | null>(null);
  const [intensity, setIntensity] = useState<number>(0.85);
  const value = useMemo(
    () => ({
      paletteKey,
      setPaletteKey,
      basePaletteKey,
      setBasePaletteKey,
      paletteOverride,
      setPaletteOverride,
      intensity,
      setIntensity,
    }),
    [paletteKey, basePaletteKey, paletteOverride, intensity],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAmbient = (): AmbientCtx => useContext(Ctx);

/**
 * Set the page's ambient palette from a stable key (title id, name, etc.).
 * Writes both base and live keys so hover-preview restores to this value.
 * Optional `override` palette is consumed by AppShell in place of the
 * hash-derived palette (e.g. colors extracted from a cover image). Resets
 * everything on unmount.
 */
export const usePageAmbient = (
  key: string | null,
  intensity = 0.85,
  override: Palette | null = null,
): void => {
  const {
    setPaletteKey,
    setBasePaletteKey,
    setPaletteOverride,
    setIntensity,
  } = useAmbient();
  useEffect(() => {
    setBasePaletteKey(key);
    setPaletteKey(key);
    setIntensity(intensity);
  }, [key, intensity, setPaletteKey, setBasePaletteKey, setIntensity]);
  useEffect(() => {
    setPaletteOverride(override);
  }, [override, setPaletteOverride]);
  useEffect(
    () => () => {
      setBasePaletteKey(null);
      setPaletteKey(null);
      setPaletteOverride(null);
    },
    [setPaletteKey, setBasePaletteKey, setPaletteOverride],
  );
};

/**
 * Hover-preview hook — temporarily swap ambient palette while user hovers.
 * Returns pointer handlers (touch-friendly). On leave, always restores from
 * `basePaletteKey` so hover chains (A → B without leaving) restore to the
 * true page palette, not the previous hover.
 *
 * Optional `url` enables image-derived hover ambience: on enter we look up the
 * extracted palette (cached or async), and apply it as the page override so
 * the wash reflects the actual cover art. Async resolutions are ignored once
 * the pointer has left, preventing stale palettes from sticking.
 */
export const useHoverAmbient = (
  key: string | null,
  url?: string | null,
) => {
  const { basePaletteKey, setPaletteKey, setPaletteOverride } = useAmbient();
  // Counter increments on every enter/leave so async resolves can detect they
  // were superseded by a newer hover or a leave.
  const hoverTokenRef = useRef(0);

  const onPointerEnter = useCallback(() => {
    if (!key) return;
    setPaletteKey(key);
    const token = ++hoverTokenRef.current;
    if (!url) {
      setPaletteOverride(null);
      return;
    }
    const { cached, promise } = getImagePalette(url);
    if (cached) {
      setPaletteOverride(cached);
      return;
    }
    setPaletteOverride(null);
    promise.then((p) => {
      if (p && hoverTokenRef.current === token) setPaletteOverride(p);
    });
  }, [key, url, setPaletteKey, setPaletteOverride]);

  const onPointerLeave = useCallback(() => {
    hoverTokenRef.current++;
    setPaletteKey(basePaletteKey);
    setPaletteOverride(null);
  }, [basePaletteKey, setPaletteKey, setPaletteOverride]);

  return {
    onPointerEnter,
    onPointerLeave,
    // legacy aliases for existing call sites
    onMouseEnter: onPointerEnter,
    onMouseLeave: onPointerLeave,
  };
};
