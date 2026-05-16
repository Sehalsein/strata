import { useEffect, useState } from "react";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

/**
 * Renders the current subtitle cue in a styled pill above the transport.
 * When Jellyfin bakes subs into the stream (HLS transcode path) there are
 * no text tracks at all — the component renders nothing, and the burned
 * subtitles remain visible from the video itself.
 */
export const SubtitleOverlay = ({ videoRef }: Props) => {
  const [text, setText] = useState<string>("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const cleanups: Array<() => void> = [];

    const bind = (track: TextTrack) => {
      // Hide native rendering so our pill is the only thing on screen.
      if (track.mode === "disabled") return;
      track.mode = "hidden";
      const onChange = () => {
        const cues = track.activeCues;
        if (!cues || cues.length === 0) {
          setText("");
          return;
        }
        const parts: string[] = [];
        for (let i = 0; i < cues.length; i++) {
          const cue = cues[i] as VTTCue;
          if (cue?.text) parts.push(cue.text);
        }
        setText(parts.join("\n").replace(/<[^>]+>/g, ""));
      };
      track.addEventListener("cuechange", onChange);
      cleanups.push(() => track.removeEventListener("cuechange", onChange));
    };

    const scan = () => {
      const list = video.textTracks;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t) bind(t);
      }
    };

    scan();
    const onAdd = () => scan();
    video.textTracks.addEventListener("addtrack", onAdd);
    cleanups.push(() => video.textTracks.removeEventListener("addtrack", onAdd));

    return () => {
      for (const fn of cleanups) fn();
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
