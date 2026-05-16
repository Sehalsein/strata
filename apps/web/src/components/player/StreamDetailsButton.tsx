import { Info } from "lucide-react";
import { forwardRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { StreamDetailsPanel } from "./StreamDetailsPanel";
import { useHlsStats } from "./hooks/useHlsStats";
import type { BaseItemDto, StreamPlan } from "@/lib/api";
import type Hls from "hls.js";

type MediaSource = NonNullable<BaseItemDto["MediaSources"]>[number];

type Props = {
  mediaSource: MediaSource | null;
  plan: StreamPlan | null;
  usingHls: boolean;
  currentAudioIndex: number | undefined;
  currentSubIndex: number | "off";
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.RefObject<Hls | null>;
};

const Trigger = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }
>(({ active, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label="Stream details"
    aria-pressed={active}
    {...props}
    className={cn(
      "inline-flex h-9 items-center gap-2 rounded-sm border border-strata-paper/20 bg-strata-bg/40 px-3 text-strata-paper transition hover:border-strata-paper/45 hover:bg-strata-paper/[0.05]",
      active && "border-strata-accent/60 bg-strata-accent/[0.08]",
      className,
    )}
  >
    <Info
      className={cn(
        "h-4 w-4",
        active ? "text-strata-accent" : "text-strata-paper/85",
      )}
    />
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-strata-paper/65">
      Info
    </span>
  </button>
));
Trigger.displayName = "StreamDetailsTrigger";

export const StreamDetailsButton = ({
  mediaSource,
  plan,
  usingHls,
  currentAudioIndex,
  currentSubIndex,
  videoRef,
  hlsRef,
}: Props) => {
  const [open, setOpen] = useState(false);
  const stats = useHlsStats(videoRef, hlsRef, open && usingHls);
  const v = videoRef.current;
  const size = { width: v?.videoWidth ?? 0, height: v?.videoHeight ?? 0 };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Trigger active={open} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="p-0">
        <StreamDetailsPanel
          mediaSource={mediaSource}
          plan={plan}
          usingHls={usingHls}
          currentAudioIndex={currentAudioIndex}
          currentSubIndex={currentSubIndex}
          videoSize={size}
          hlsStats={stats}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
