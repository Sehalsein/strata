import { useEffect, useState } from "react";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

/**
 * Renders the current subtitle cue in a styled pill above the transport.
 *
 * Polls activeCues on `timeupdate` (and a short interval as a fallback
 * for when the video is paused or `timeupdate` is throttled). We poll
 * instead of subscribing to `cuechange` because browsers fire it
 * inconsistently when a track's mode is "hidden" — Chrome in
 * particular often drops the event entirely.
 */
export const SubtitleOverlay = ({ videoRef }: Props) => {
  const [text, setText] = useState<string>("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const tick = () => {
      const tracks = video.textTracks;
      let next = "";
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (!t) continue;
        if (t.kind !== "subtitles" && t.kind !== "captions") continue;
        // Ensure cues actually load; "disabled" suppresses loading
        // entirely and would leave activeCues null forever.
        if (t.mode === "disabled") t.mode = "hidden";
        const cues = t.activeCues;
        if (!cues || cues.length === 0) continue;
        const parts: string[] = [];
        for (let j = 0; j < cues.length; j++) {
          const cue = cues[j] as VTTCue;
          if (cue?.text) parts.push(cue.text);
        }
        if (parts.length > 0) {
          next = parts.join("\n").replace(/<[^>]+>/g, "");
          break;
        }
      }
      setText((prev) => (prev === next ? prev : next));
    };

    // 250 ms is below the perception threshold for subtitle timing and
    // covers the paused-with-subs-enabled case (where `timeupdate` and
    // `seeked` would never fire).
    const interval = window.setInterval(tick, 250);

    return () => {
      window.clearInterval(interval);
      setText("");
    };
  }, [videoRef]);

  if (!text) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-32 z-20 flex justify-center px-6">
      <span className="max-w-3xl whitespace-pre-line rounded-md bg-strata-bg/75 px-4 py-2 text-center text-base font-medium leading-snug text-strata-paper shadow-lg backdrop-blur-sm sm:text-lg">
        {text}
      </span>
    </div>
  );
};
