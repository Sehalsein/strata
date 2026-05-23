import { useEffect } from "react";

type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockAPI = {
  request: (type: "screen") => Promise<WakeLockSentinel>;
};

const getWakeLock = (): WakeLockAPI | null => {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as unknown as { wakeLock?: WakeLockAPI };
  return nav.wakeLock ?? null;
};

/**
 * Holds a screen wake lock while `active` is true. Re-acquires on tab
 * re-visibility (browsers release the lock automatically when the tab
 * hides). Silently no-ops where the API isn't available (older Safari,
 * insecure contexts).
 */
export const useWakeLock = (active: boolean) => {
  useEffect(() => {
    const api = getWakeLock();
    if (!active || !api) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await api.request("screen");
        if (cancelled) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
      } catch {
        // permission denied / unsupported context — silently no-op
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinel) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel) {
        void sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [active]);
};
