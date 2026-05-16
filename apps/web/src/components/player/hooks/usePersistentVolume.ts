import { useEffect, useRef } from "react";

const STORAGE_KEY = "strata.volume";
const STORAGE_MUTED = "strata.muted";

type Snapshot = { volume: number; muted: boolean };

const readSnapshot = (): Snapshot => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw === null ? 1 : Number.parseFloat(raw);
    const volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    const muted = localStorage.getItem(STORAGE_MUTED) === "1";
    return { volume, muted };
  } catch {
    return { volume: 1, muted: false };
  }
};

const writeSnapshot = (snap: Snapshot) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(snap.volume));
    localStorage.setItem(STORAGE_MUTED, snap.muted ? "1" : "0");
  } catch {
    // ignore quota / private-mode failures
  }
};

/**
 * Restores volume + mute from localStorage on mount, then persists changes
 * with a small debounce so dragging the slider doesn't thrash localStorage.
 */
export const usePersistentVolume = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
) => {
  const debounceRef = useRef<number | null>(null);
  const appliedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const apply = () => {
      const snap = readSnapshot();
      video.volume = snap.volume;
      video.muted = snap.muted;
      appliedRef.current = true;
    };

    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });

    const onChange = () => {
      if (!appliedRef.current) return;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        writeSnapshot({ volume: video.volume, muted: video.muted });
      }, 300);
    };
    video.addEventListener("volumechange", onChange);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
      video.removeEventListener("loadedmetadata", apply);
      video.removeEventListener("volumechange", onChange);
    };
  }, [videoRef]);
};
