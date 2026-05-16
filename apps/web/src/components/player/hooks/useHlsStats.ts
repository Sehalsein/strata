import { useEffect, useState } from "react";
import type Hls from "hls.js";

export type HlsStats = {
  level: {
    width: number;
    height: number;
    bitrate: number;
  } | null;
  bufferAhead: number;
  droppedFrames: number;
  totalFrames: number;
};

const empty: HlsStats = {
  level: null,
  bufferAhead: 0,
  droppedFrames: 0,
  totalFrames: 0,
};

const bufferedAhead = (video: HTMLVideoElement): number => {
  const t = video.currentTime;
  const b = video.buffered;
  for (let i = 0; i < b.length; i++) {
    if (t >= b.start(i) && t <= b.end(i)) return Math.max(0, b.end(i) - t);
  }
  return 0;
};

/**
 * Polls the video element (and the optional hls.js instance) at 4Hz for
 * playback technicals — current bitrate level, buffer ahead, dropped frame
 * counter. Polling is the cheapest option here: hls.js fires LEVEL_SWITCHED
 * sparingly and dropped-frame counters update continuously.
 */
export const useHlsStats = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  hlsRef: React.RefObject<Hls | null>,
  enabled: boolean,
): HlsStats => {
  const [stats, setStats] = useState<HlsStats>(empty);

  useEffect(() => {
    if (!enabled) {
      setStats(empty);
      return;
    }
    const handle = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const hls = hlsRef.current;
      let level: HlsStats["level"] = null;
      if (hls && hls.currentLevel >= 0 && hls.levels[hls.currentLevel]) {
        const L = hls.levels[hls.currentLevel]!;
        level = {
          width: L.width ?? 0,
          height: L.height ?? 0,
          bitrate: L.bitrate ?? 0,
        };
      }
      const q = video.getVideoPlaybackQuality?.();
      setStats({
        level,
        bufferAhead: bufferedAhead(video),
        droppedFrames: q?.droppedVideoFrames ?? 0,
        totalFrames: q?.totalVideoFrames ?? 0,
      });
    }, 250);
    return () => window.clearInterval(handle);
  }, [enabled, hlsRef, videoRef]);

  return stats;
};
