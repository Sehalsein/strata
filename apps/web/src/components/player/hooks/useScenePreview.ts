import { useCallback, useEffect, useRef, useState } from "react";

const PREVIEW_W = 192;
const PREVIEW_H = 108;

export type ScenePreview = {
  previewUrl: string | null;
  requestPreview: (sec: number) => void;
};

/**
 * Live scene-preview generator. Mounts a hidden mirror `<video>` for the
 * given source URL and renders the frame at any requested time to a JPEG
 * data URL via a `<canvas>`. Used as a fallback when the Jellyfin item
 * has no trickplay manifest.
 *
 * Pass `null` for the source URL to disable — no mirror is mounted and
 * `requestPreview` becomes a no-op. Callers should gate the source on
 * conditions where seeking is cheap (i.e. direct-playable mp4/m4v/mov,
 * NOT HLS where each seek triggers a transcode segment).
 */
export const useScenePreview = (sourceUrl: string | null): ScenePreview => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingTimeRef = useRef<number | null>(null);
  const disabledRef = useRef<boolean>(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceUrl) {
      setPreviewUrl(null);
      return;
    }
    disabledRef.current = false;

    const video = document.createElement("video");
    video.src = sourceUrl;
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
    videoRef.current = video;

    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d");

    const drainPending = () => {
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
      if (!ctx || disabledRef.current) {
        drainPending();
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, PREVIEW_W, PREVIEW_H);
        const url = canvas.toDataURL("image/jpeg", 0.6);
        setPreviewUrl(url);
      } catch (err) {
        // Canvas tainted (CORS misconfig) — disable the fallback so the
        // tooltip degrades to timestamp-only instead of throwing forever.
        disabledRef.current = true;
        console.warn("[scene-preview] disabled — canvas tainted", err);
      }
      drainPending();
    };

    video.addEventListener("seeked", onSeeked);

    return () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* noop */
      }
      video.remove();
      videoRef.current = null;
      canvasRef.current = null;
      pendingTimeRef.current = null;
      setPreviewUrl(null);
    };
  }, [sourceUrl]);

  const requestPreview = useCallback((sec: number) => {
    const video = videoRef.current;
    if (!video || disabledRef.current) return;
    if (!Number.isFinite(sec) || sec < 0) return;
    // Coalesce: while a seek is in flight, remember the latest target and
    // apply it on the next `seeked` event.
    if (video.seeking) {
      pendingTimeRef.current = sec;
      return;
    }
    try {
      video.currentTime = sec;
    } catch {
      pendingTimeRef.current = sec;
    }
  }, []);

  return { previewUrl, requestPreview };
};
