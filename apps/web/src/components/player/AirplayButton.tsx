import { memo, useEffect, useState } from "react";
import { Airplay } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

type WebKitAvailabilityEvent = Event & {
  availability: "available" | "not-available";
};

type WebKitVideoElement = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
};

/**
 * AirPlay control. Renders nothing unless the browser exposes the
 * Remote Playback API (or Safari's legacy WebKit equivalent) AND a
 * receiver is reachable on the network — Chrome/Firefox users never
 * see the button.
 */
export const AirplayButton = memo(function AirplayButton({ videoRef }: Props) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const remote = video.remote;
    if (remote && typeof remote.watchAvailability === "function") {
      let callbackId: number | undefined;
      remote
        .watchAvailability((a) => setAvailable(a))
        .then((id) => {
          callbackId = id;
        })
        .catch(() => {});
      return () => {
        if (callbackId !== undefined) {
          remote.cancelWatchAvailability(callbackId).catch(() => {});
        }
      };
    }

    const onAvail = (e: Event) =>
      setAvailable((e as WebKitAvailabilityEvent).availability === "available");
    video.addEventListener(
      "webkitplaybacktargetavailabilitychanged",
      onAvail,
    );
    return () =>
      video.removeEventListener(
        "webkitplaybacktargetavailabilitychanged",
        onAvail,
      );
  }, [videoRef]);

  if (!available) return null;

  const open = () => {
    const video = videoRef.current;
    if (!video) return;
    const remote = video.remote;
    if (remote && typeof remote.prompt === "function") {
      void remote.prompt().catch(() => {});
      return;
    }
    const webkit = video as WebKitVideoElement;
    webkit.webkitShowPlaybackTargetPicker?.();
  };

  return (
    <button
      type="button"
      onClick={open}
      aria-label="AirPlay"
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full text-strata-paper transition hover:bg-strata-paper/10",
      )}
    >
      <Airplay className="h-4 w-4" />
    </button>
  );
});
