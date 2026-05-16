import { useEffect, useRef } from "react";
import type { PlayerApi } from "../types";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
};

const stepSpeed = (current: number, dir: 1 | -1): number => {
  const idx = SPEEDS.findIndex((s) => Math.abs(s - current) < 0.01);
  if (idx === -1) return 1;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, idx + dir))]!;
};

export const useKeyboardShortcuts = (
  api: PlayerApi,
  videoRef: React.RefObject<HTMLVideoElement | null>,
) => {
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const video = videoRef.current;
      const a = apiRef.current;
      const key = e.key;

      switch (key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          a.toggle();
          return;
        case "c":
        case "C":
          e.preventDefault();
          a.toggleSubtitle();
          return;
        case "i":
        case "I":
          e.preventDefault();
          a.toggleRail();
          return;
        case "ArrowLeft":
        case "j":
        case "J":
          e.preventDefault();
          a.seekBy(-10);
          return;
        case "ArrowRight":
        case "l":
        case "L":
          e.preventDefault();
          a.seekBy(10);
          return;
        case "f":
        case "F":
          e.preventDefault();
          a.toggleFullscreen();
          return;
        case "m":
        case "M":
          e.preventDefault();
          a.toggleMute();
          return;
        case "ArrowUp":
          e.preventDefault();
          if (video) a.setVolume(Math.min(1, video.volume + 0.05));
          return;
        case "ArrowDown":
          e.preventDefault();
          if (video) a.setVolume(Math.max(0, video.volume - 0.05));
          return;
        case "[":
          e.preventDefault();
          if (video) a.setRate(stepSpeed(video.playbackRate, -1));
          return;
        case "]":
          e.preventDefault();
          if (video) a.setRate(stepSpeed(video.playbackRate, 1));
          return;
        case "N":
          if (e.shiftKey) {
            e.preventDefault();
            a.nextEpisode?.();
          }
          return;
        case "P":
          if (e.shiftKey) {
            e.preventDefault();
            a.prevEpisode?.();
          }
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoRef]);
};
