import { useCallback, useEffect, useReducer, useRef } from "react";

const HIDE_DELAY_MS = 3000;

export type AutoHide = {
  visible: boolean;
  bump: () => void;
  hideNow: () => void;
};

/**
 * Ref-based idle-timer. Mouse-move bumps the timer without re-rendering
 * (refs only); React only re-renders on the visibility transition.
 * The hover handler can fire at 60Hz without thrashing the tree.
 */
export const useAutoHide = (active: boolean): AutoHide => {
  const visibleRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);

  const setVisible = useCallback((v: boolean) => {
    if (visibleRef.current === v) return;
    visibleRef.current = v;
    tick();
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const bump = useCallback(() => {
    setVisible(true);
    clearTimer();
    if (active) {
      timerRef.current = window.setTimeout(
        () => setVisible(false),
        HIDE_DELAY_MS,
      );
    }
  }, [active, clearTimer, setVisible]);

  const hideNow = useCallback(() => {
    clearTimer();
    if (active) setVisible(false);
  }, [active, clearTimer, setVisible]);

  useEffect(() => {
    // When playback stops, controls must stay visible and the timer is
    // pointless. When playback resumes, start a fresh idle countdown.
    if (!active) {
      clearTimer();
      setVisible(true);
    } else {
      bump();
    }
    return clearTimer;
  }, [active, bump, clearTimer, setVisible]);

  return { visible: visibleRef.current, bump, hideNow };
};
