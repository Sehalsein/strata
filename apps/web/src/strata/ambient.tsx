import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AmbientCtx = {
  // Live palette key — drives the current backdrop. May be a hover preview.
  paletteKey: string | null;
  setPaletteKey: (key: string | null) => void;
  // Source-of-truth palette key for the current page (no preview).
  // Hover-leave restores from this.
  basePaletteKey: string | null;
  setBasePaletteKey: (key: string | null) => void;
  intensity: number;
  setIntensity: (n: number) => void;
};

const Ctx = createContext<AmbientCtx>({
  paletteKey: null,
  setPaletteKey: () => {},
  basePaletteKey: null,
  setBasePaletteKey: () => {},
  intensity: 0.85,
  setIntensity: () => {},
});

export const AmbientProvider = ({ children }: { children: ReactNode }) => {
  const [paletteKey, setPaletteKey] = useState<string | null>(null);
  const [basePaletteKey, setBasePaletteKey] = useState<string | null>(null);
  const [intensity, setIntensity] = useState<number>(0.85);
  const value = useMemo(
    () => ({
      paletteKey,
      setPaletteKey,
      basePaletteKey,
      setBasePaletteKey,
      intensity,
      setIntensity,
    }),
    [paletteKey, basePaletteKey, intensity],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAmbient = (): AmbientCtx => useContext(Ctx);

/**
 * Set the page's ambient palette from a stable key (title id, name, etc.).
 * Writes both base and live keys so hover-preview restores to this value.
 * Resets on unmount.
 */
export const usePageAmbient = (key: string | null, intensity = 0.85): void => {
  const { setPaletteKey, setBasePaletteKey, setIntensity } = useAmbient();
  useEffect(() => {
    setBasePaletteKey(key);
    setPaletteKey(key);
    setIntensity(intensity);
  }, [key, intensity, setPaletteKey, setBasePaletteKey, setIntensity]);
  useEffect(
    () => () => {
      setBasePaletteKey(null);
      setPaletteKey(null);
    },
    [setPaletteKey, setBasePaletteKey],
  );
};

/**
 * Hover-preview hook — temporarily swap ambient palette while user hovers.
 * Returns pointer handlers (touch-friendly). On leave, always restores from
 * `basePaletteKey` so hover chains (A → B without leaving) restore to the
 * true page palette, not the previous hover.
 */
export const useHoverAmbient = (key: string | null) => {
  const { basePaletteKey, setPaletteKey } = useAmbient();
  const onPointerEnter = useCallback(() => {
    if (!key) return;
    setPaletteKey(key);
  }, [key, setPaletteKey]);
  const onPointerLeave = useCallback(() => {
    setPaletteKey(basePaletteKey);
  }, [basePaletteKey, setPaletteKey]);
  return {
    onPointerEnter,
    onPointerLeave,
    // legacy aliases for existing call sites
    onMouseEnter: onPointerEnter,
    onMouseLeave: onPointerLeave,
  };
};
