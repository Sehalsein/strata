import { useEffect, useRef, useState } from "react";

export type VideoState = {
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  rate: number;
  buffered: number;
};

const empty: VideoState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  rate: 1,
  buffered: 0,
};

/**
 * Mirrors a <video> element's playback state into React. Time updates are
 * throttled via rAF so consumers re-render at ~screen cadence instead of
 * each `timeupdate` firing (which is ~4Hz and uneven).
 */
export const useVideoState = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
): VideoState => {
  const [state, setState] = useState<VideoState>(empty);
  const stateRef = useRef(state);
  stateRef.current = state;
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<Partial<VideoState>>({});

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const flush = () => {
      rafRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = {};
      setState((prev) => ({ ...prev, ...pending }));
    };

    const schedule = (patch: Partial<VideoState>) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };

    const bufferedEnd = (): number => {
      const b = video.buffered;
      if (!b.length) return 0;
      const t = video.currentTime;
      for (let i = 0; i < b.length; i++) {
        if (t >= b.start(i) && t <= b.end(i)) return b.end(i);
      }
      return b.end(b.length - 1);
    };

    const snapshot = (): Partial<VideoState> => ({
      playing: !video.paused && !video.ended,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      volume: video.volume,
      muted: video.muted,
      rate: video.playbackRate,
      buffered: bufferedEnd(),
    });

    const onTimeUpdate = () =>
      schedule({ currentTime: video.currentTime, buffered: bufferedEnd() });
    const onPlay = () => schedule({ playing: true });
    const onPause = () => schedule({ playing: false });
    const onEnded = () => schedule({ playing: false });
    const onDuration = () =>
      schedule({
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      });
    const onVolume = () =>
      schedule({ volume: video.volume, muted: video.muted });
    const onRate = () => schedule({ rate: video.playbackRate });
    const onProgress = () => schedule({ buffered: bufferedEnd() });

    schedule(snapshot());

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("loadedmetadata", onDuration);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("ratechange", onRate);
    video.addEventListener("progress", onProgress);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("loadedmetadata", onDuration);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("ratechange", onRate);
      video.removeEventListener("progress", onProgress);
    };
  }, [videoRef]);

  return state;
};
