import { useCallback, useEffect, useState } from "react";

type WebKitPresentationMode = "inline" | "picture-in-picture" | "fullscreen";

type WebKitVideoElement = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: WebKitPresentationMode) => boolean;
  webkitPresentationMode?: WebKitPresentationMode;
  webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void;
};

type State = {
  supported: boolean;
  isActive: boolean;
  toggle: () => void;
};

const standardSupported = (): boolean =>
  typeof document !== "undefined" &&
  document.pictureInPictureEnabled === true;

const webkitSupported = (video: HTMLVideoElement | null): boolean => {
  if (!video) return false;
  const v = video as WebKitVideoElement;
  return v.webkitSupportsPresentationMode?.("picture-in-picture") === true;
};

/**
 * Picture-in-Picture toggle. Returns `supported: false` when no API is
 * available — caller should hide the button entirely in that case.
 *
 * Prefers the standard Picture-in-Picture Web API; falls back to the
 * legacy WebKit `webkitPresentationMode` API on older iOS Safari builds.
 */
export const usePictureInPicture = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
): State => {
  const [supported, setSupported] = useState(false);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const std = standardSupported();
    const wk = webkitSupported(video);
    setSupported(std || wk);

    if (std) {
      const onEnter = () => setIsActive(true);
      const onLeave = () => setIsActive(false);
      video.addEventListener("enterpictureinpicture", onEnter);
      video.addEventListener("leavepictureinpicture", onLeave);
      return () => {
        video.removeEventListener("enterpictureinpicture", onEnter);
        video.removeEventListener("leavepictureinpicture", onLeave);
      };
    }

    if (wk) {
      const v = video as WebKitVideoElement;
      const onChange = () => {
        setIsActive(v.webkitPresentationMode === "picture-in-picture");
      };
      video.addEventListener("webkitpresentationmodechanged", onChange);
      return () =>
        video.removeEventListener("webkitpresentationmodechanged", onChange);
    }
  }, [videoRef]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (standardSupported()) {
      if (document.pictureInPictureElement === video) {
        void document.exitPictureInPicture().catch(() => {});
      } else {
        void video.requestPictureInPicture().catch(() => {});
      }
      return;
    }

    if (webkitSupported(video)) {
      const v = video as WebKitVideoElement;
      const next: WebKitPresentationMode =
        v.webkitPresentationMode === "picture-in-picture"
          ? "inline"
          : "picture-in-picture";
      v.webkitSetPresentationMode?.(next);
    }
  }, [videoRef]);

  return { supported, isActive, toggle };
};
