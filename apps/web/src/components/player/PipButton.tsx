import { memo } from "react";
import { PictureInPicture2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePictureInPicture } from "./hooks/usePictureInPicture";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

export const PipButton = memo(function PipButton({ videoRef }: Props) {
  const { supported, isActive, toggle } = usePictureInPicture(videoRef);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isActive ? "Exit Picture in Picture" : "Picture in Picture"}
      aria-pressed={isActive}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full text-strata-paper transition hover:bg-strata-paper/10",
        isActive && "bg-strata-paper/15",
      )}
    >
      <PictureInPicture2 className="h-4 w-4" />
    </button>
  );
});
