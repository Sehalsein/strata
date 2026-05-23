import { Lock, LockOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const HOLD_MS = 700;
const PILL_HIDE_MS = 3000;

type Props = {
  locked: boolean;
  onUnlock: () => void;
};

/**
 * Full-surface absorber rendered while the player is locked. Catches
 * every tap so transport, scrubber, and double-tap-seek can't fire.
 *
 * Unlocking requires a deliberate hold on the unlock pill — a single
 * tap only re-reveals the pill, so an accidental brush stays harmless.
 */
export const LockOverlay = ({ locked, onUnlock }: Props) => {
  const [pillVisible, setPillVisible] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const hideTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const holdRaf = useRef<number | null>(null);

  const clearHideTimer = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const showPill = useCallback(() => {
    setPillVisible(true);
    clearHideTimer();
    hideTimer.current = window.setTimeout(
      () => setPillVisible(false),
      PILL_HIDE_MS,
    );
  }, []);

  // Show the pill briefly when entering locked mode so the user knows
  // how to unlock.
  useEffect(() => {
    if (locked) showPill();
    else {
      setPillVisible(false);
      setHoldProgress(0);
      clearHideTimer();
    }
    return clearHideTimer;
  }, [locked, showPill]);

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (holdRaf.current !== null) {
      window.cancelAnimationFrame(holdRaf.current);
      holdRaf.current = null;
    }
    setHoldProgress(0);
  }, []);

  const beginHold = useCallback(() => {
    cancelHold();
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      setHoldProgress(Math.min(1, elapsed / HOLD_MS));
      if (elapsed < HOLD_MS) {
        holdRaf.current = window.requestAnimationFrame(tick);
      }
    };
    holdRaf.current = window.requestAnimationFrame(tick);
    holdTimer.current = window.setTimeout(() => {
      cancelHold();
      onUnlock();
    }, HOLD_MS);
  }, [cancelHold, onUnlock]);

  useEffect(() => cancelHold, [cancelHold]);

  if (!locked) return null;

  return (
    <>
      {/* Absorber. Stops every pointer event before it reaches the
          transport/scrubber/tap-overlay below. */}
      <div
        className="absolute inset-0 z-40 touch-none select-none [-webkit-touch-callout:none]"
        onPointerDown={(e) => {
          e.stopPropagation();
          showPill();
        }}
        onPointerUp={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        aria-hidden
      />
      {/* Unlock pill. Hold-to-unlock; a brief tap is forgiving. */}
      <div
        className={cn(
          "pointer-events-none absolute z-50 transition-opacity duration-200",
          pillVisible ? "opacity-100" : "opacity-0",
        )}
        style={{
          top: "max(1.25rem, env(safe-area-inset-top))",
          right: "max(1.25rem, env(safe-area-inset-right))",
        }}
      >
        <button
          type="button"
          aria-label="Hold to unlock"
          className={cn(
            "pointer-events-auto relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-strata-paper/25 bg-strata-bg/75 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-strata-paper backdrop-blur",
            !pillVisible && "pointer-events-none",
          )}
          onPointerDown={beginHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
        >
          <span
            className="absolute inset-y-0 left-0 bg-strata-paper/15"
            style={{ width: `${holdProgress * 100}%` }}
            aria-hidden
          />
          <Lock className="relative h-3.5 w-3.5" />
          <span className="relative">Hold to unlock</span>
          <LockOpen
            className={cn(
              "relative h-3.5 w-3.5 transition-opacity",
              holdProgress > 0.5 ? "opacity-100" : "opacity-0",
            )}
          />
        </button>
      </div>
    </>
  );
};
