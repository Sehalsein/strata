import { useCallback, useEffect, useRef, useState } from "react";

const PREVIEW_W = 192;
const PREVIEW_H = 108;
// Wait this long after the last `requestPreview` call before actually
// firing the seek — keeps a fast scrub from issuing one fetch per pixel.
const SEEK_DEBOUNCE_MS = 80;

export type ScenePreview = {
  previewUrl: string | null;
  requestPreview: (sec: number) => void;
};

/**
 * Live scene-preview generator. Lazily mounts a hidden mirror `<video>`
 * the *first* time the user requests a preview — until then no second
 * connection to the Jellyfin source exists. Subsequent requests reuse
 * the same mirror (no remount churn on hover toggle). The mirror is
 * torn down when the source URL changes or the consumer unmounts.
 *
 * Seek requests are debounced ~80 ms so a fast scrub doesn't fire a
 * stream of range requests at the server.
 *
 * Pass `null` for the source to disable.
 */
export const useScenePreview = (sourceUrl: string | null): ScenePreview => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Latest source URL — read inside the lazy-init path.
  const sourceUrlRef = useRef<string | null>(sourceUrl);
  sourceUrlRef.current = sourceUrl;

  // Seek setter for the currently-mounted mirror, or null when not mounted.
  const seekRef = useRef<((sec: number) => void) | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);

  const debounceTimerRef = useRef<number | null>(null);
  const pendingTimeRef = useRef<number | null>(null);

  // Tear down whenever the source URL changes or the consumer unmounts.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingTimeRef.current = null;
      teardownRef.current?.();
      teardownRef.current = null;
      seekRef.current = null;
      setPreviewUrl(null);
    };
  }, [sourceUrl]);

  const ensureMounted = useCallback(() => {
    if (seekRef.current) return;
    const url = sourceUrlRef.current;
    if (!url) return;

    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    document.body.appendChild(video);

    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    const ctx = canvas.getContext("2d");

    let disabled = false;

    const applyPending = () => {
      const pending = pendingTimeRef.current;
      if (pending === null) return;
      if (Math.abs(video.currentTime - pending) < 0.5) {
        pendingTimeRef.current = null;
        return;
      }
      pendingTimeRef.current = null;
      try {
        video.currentTime = pending;
      } catch {
        /* seek before metadata — ignore */
      }
    };

    const onSeeked = () => {
      if (!ctx || disabled) {
        applyPending();
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, PREVIEW_W, PREVIEW_H);
        setPreviewUrl(canvas.toDataURL("image/jpeg", 0.6));
      } catch (err) {
        disabled = true;
        console.warn("[scene-preview] disabled — canvas tainted", err);
      }
      applyPending();
    };

    video.addEventListener("seeked", onSeeked);

    seekRef.current = (sec: number) => {
      if (video.seeking) {
        pendingTimeRef.current = sec;
        return;
      }
      try {
        video.currentTime = sec;
      } catch {
        pendingTimeRef.current = sec;
      }
    };

    teardownRef.current = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* noop */
      }
      video.remove();
    };
  }, []);

  const requestPreview = useCallback(
    (sec: number) => {
      if (!Number.isFinite(sec) || sec < 0) return;
      if (!sourceUrlRef.current) return;

      pendingTimeRef.current = sec;
      if (debounceTimerRef.current !== null) return;
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        const target = pendingTimeRef.current;
        if (target === null) return;
        pendingTimeRef.current = null;
        ensureMounted();
        seekRef.current?.(target);
      }, SEEK_DEBOUNCE_MS);
    },
    [ensureMounted],
  );

  return { previewUrl, requestPreview };
};
