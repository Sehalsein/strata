import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn, formatTime } from "@/lib/utils";
import type Hls from "hls.js";
import type { BaseItemDto, StreamPlan } from "@/lib/api";
import { CaptionsButton } from "./CaptionsButton";
import { AudioButton } from "./AudioButton";
import { SpeedButton } from "./SpeedButton";
import { StreamDetailsButton } from "./StreamDetailsButton";
import { RailToggleButton } from "./RailToggleButton";
import { AirplayButton } from "./AirplayButton";
import type { PlayerApi, Stream } from "./types";
import type { VideoState } from "./hooks/useVideoState";

type MediaSource = NonNullable<BaseItemDto["MediaSources"]>[number];

type Props = {
  api: PlayerApi;
  state: VideoState;
  audioTracks: Stream[];
  subtitleTracks: Stream[];
  currentAudio: number | undefined;
  currentSub: number | "off";
  onAudioChange: (index: number) => void;
  onSubChange: (value: number | "off") => void;
  hasPrev: boolean;
  hasNext: boolean;
  mediaSource: MediaSource | null;
  plan: StreamPlan | null;
  usingHls: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.RefObject<Hls | null>;
  railVisible: boolean;
  railHasContent: boolean;
};

const IconBtn = ({
  onClick,
  disabled,
  ariaLabel,
  children,
  className,
}: {
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className={cn(
      "inline-flex h-9 w-9 items-center justify-center rounded-full text-strata-paper transition hover:bg-strata-paper/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
      className,
    )}
  >
    {children}
  </button>
);

export const TransportBar = ({
  api,
  state,
  audioTracks,
  subtitleTracks,
  currentAudio,
  currentSub,
  onAudioChange,
  onSubChange,
  hasPrev,
  hasNext,
  mediaSource,
  plan,
  usingHls,
  videoRef,
  hlsRef,
  railVisible,
  railHasContent,
}: Props) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    Boolean(document.fullscreenElement),
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const remaining = Math.max(0, (state.duration || 0) - state.currentTime);
  const muted = state.muted || state.volume === 0;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-y-2 gap-x-2">
      <div className="flex items-center gap-1">
        <IconBtn
          ariaLabel="Previous episode"
          onClick={api.prevEpisode ?? undefined}
          disabled={!hasPrev}
        >
          <SkipBack className="h-4 w-4" />
        </IconBtn>
        <IconBtn
          ariaLabel="Back 10 seconds"
          onClick={() => api.seekBy(-10)}
        >
          <RotateCcw className="h-4 w-4" />
        </IconBtn>
        <button
          type="button"
          aria-label={state.playing ? "Pause" : "Play"}
          onClick={api.toggle}
          className="ml-1 inline-flex h-12 w-12 items-center justify-center rounded-full bg-strata-paper text-strata-bg transition hover:bg-strata-accent hover:text-strata-paper"
        >
          {state.playing ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 translate-x-px" />
          )}
        </button>
        <IconBtn
          ariaLabel="Forward 10 seconds"
          onClick={() => api.seekBy(10)}
          className="ml-1"
        >
          <RotateCw className="h-4 w-4" />
        </IconBtn>
        <IconBtn
          ariaLabel="Next episode"
          onClick={api.nextEpisode ?? undefined}
          disabled={!hasNext}
        >
          <SkipForward className="h-4 w-4" />
        </IconBtn>
      </div>

      <div className="ml-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-strata-paper/70 tabular-nums">
        <span>{formatTime(state.currentTime)}</span>
        <span className="text-strata-paper/30">/</span>
        <span className="text-strata-paper/50">
          -{formatTime(remaining)}
        </span>
      </div>

      <div className="flex-1" />

      <div className="group flex items-center gap-1">
        <IconBtn
          ariaLabel={muted ? "Unmute" : "Mute"}
          onClick={api.toggleMute}
        >
          {muted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </IconBtn>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : state.volume}
          onChange={(e) => api.setVolume(Number.parseFloat(e.target.value))}
          className="strata-volume h-1 w-0 appearance-none rounded-full bg-strata-paper/20 outline-none transition-[width] duration-200 group-hover:w-24 focus-visible:w-24"
          style={{
            backgroundImage: `linear-gradient(to right, var(--color-strata-paper) ${
              (muted ? 0 : state.volume) * 100
            }%, transparent 0)`,
          }}
        />
      </div>

      <CaptionsButton
        tracks={subtitleTracks}
        current={currentSub}
        onChange={onSubChange}
        onToggle={api.toggleSubtitle}
      />

      <AudioButton
        tracks={audioTracks}
        current={currentAudio}
        onChange={onAudioChange}
      />

      <SpeedButton
        rate={state.rate}
        onChange={api.setRate}
        onCycle={api.cycleSpeed}
      />

      <StreamDetailsButton
        mediaSource={mediaSource}
        plan={plan}
        usingHls={usingHls}
        currentAudioIndex={currentAudio}
        currentSubIndex={currentSub}
        videoRef={videoRef}
        hlsRef={hlsRef}
      />

      {railHasContent && (
        <RailToggleButton open={railVisible} onToggle={api.toggleRail} />
      )}

      <AirplayButton videoRef={videoRef} />

      <IconBtn
        ariaLabel={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={api.toggleFullscreen}
        className="ml-1"
      >
        {isFullscreen ? (
          <Minimize className="h-4 w-4" />
        ) : (
          <Maximize className="h-4 w-4" />
        )}
      </IconBtn>
    </div>
  );
};
