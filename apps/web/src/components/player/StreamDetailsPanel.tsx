import type { BaseItemDto, StreamPlan } from "@/lib/api";
import { cn, formatBitrate } from "@/lib/utils";
import type { HlsStats } from "./hooks/useHlsStats";

type MediaSource = NonNullable<BaseItemDto["MediaSources"]>[number];
type MediaStream = NonNullable<MediaSource["MediaStreams"]>[number];

type Props = {
  mediaSource: MediaSource | null;
  plan: StreamPlan | null;
  usingHls: boolean;
  currentAudioIndex: number | undefined;
  currentSubIndex: number | "off";
  videoSize: { width: number; height: number };
  hlsStats: HlsStats;
};

const pickStream = (
  source: MediaSource | null,
  type: "Video" | "Audio" | "Subtitle",
  index?: number,
): MediaStream | undefined => {
  if (!source?.MediaStreams) return undefined;
  if (index !== undefined) {
    return source.MediaStreams.find((s) => s.Type === type && s.Index === index);
  }
  return (
    source.MediaStreams.find((s) => s.Type === type && s.IsDefault) ??
    source.MediaStreams.find((s) => s.Type === type)
  );
};

const codec = (s: MediaStream | undefined): string =>
  s?.Codec ? s.Codec.toUpperCase() : "—";

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1">
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-strata-paper/50">
      {k}
    </span>
    <span className="truncate text-right font-mono text-[11px] text-strata-paper">
      {v ?? "—"}
    </span>
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-px">
    <h4 className="mb-1 border-b border-strata-paper/10 pb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/65">
      {title}
    </h4>
    {children}
  </section>
);

export const StreamDetailsPanel = ({
  mediaSource,
  plan,
  usingHls,
  currentAudioIndex,
  currentSubIndex,
  videoSize,
  hlsStats,
}: Props) => {
  const video = pickStream(mediaSource, "Video");
  const audio = pickStream(mediaSource, "Audio", currentAudioIndex);
  const sub =
    currentSubIndex === "off"
      ? undefined
      : pickStream(mediaSource, "Subtitle", currentSubIndex);

  const resolution =
    video?.Width && video?.Height ? `${video.Width}×${video.Height}` : null;
  const fps =
    video?.AverageFrameRate ?? video?.RealFrameRate ?? null;
  const audioChannels = audio?.ChannelLayout ?? (audio?.Channels ? `${audio.Channels}ch` : null);

  const playerSize = `${videoSize.width || 0}×${videoSize.height || 0}`;
  const levelRes =
    hlsStats.level && hlsStats.level.width && hlsStats.level.height
      ? `${hlsStats.level.width}×${hlsStats.level.height}`
      : null;

  return (
    <div className="w-[360px] space-y-4 p-4">
      <Section title="Source">
        <Row k="Container" v={mediaSource?.Container?.toUpperCase() ?? "—"} />
        <Row
          k="Video"
          v={
            <>
              {codec(video)}
              {video?.Profile ? ` ${video.Profile}` : ""}
              {video?.VideoRange ? (
                <span
                  className={cn(
                    "ml-1.5 rounded-sm border px-1 py-px text-[9px] uppercase tracking-[0.14em]",
                    video.VideoRange === "HDR"
                      ? "border-strata-accent-2/50 text-strata-accent-2"
                      : "border-strata-paper/20 text-strata-paper/70",
                  )}
                >
                  {video.VideoRange}
                </span>
              ) : null}
            </>
          }
        />
        <Row k="Resolution" v={resolution} />
        <Row
          k="Source bitrate"
          v={formatBitrate(video?.BitRate ?? mediaSource?.Bitrate ?? null)}
        />
        <Row
          k="Frame rate"
          v={fps ? `${Number(fps).toFixed(2)} fps` : null}
        />
        <Row
          k="Audio"
          v={
            <>
              {codec(audio)}
              {audioChannels ? ` · ${audioChannels.toUpperCase()}` : ""}
              {audio?.Language ? ` · ${audio.Language.toUpperCase()}` : ""}
            </>
          }
        />
        <Row
          k="Subtitle"
          v={
            currentSubIndex === "off"
              ? "Off"
              : sub
                ? `${codec(sub)} · ${(sub.Language ?? "—").toUpperCase()}${sub.IsForced ? " · Forced" : ""}`
                : null
          }
        />
      </Section>

      <Section title="Playback">
        <Row
          k="Method"
          v={
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  usingHls ? "bg-strata-accent-2" : "bg-strata-success",
                )}
              />
              {usingHls ? "HLS transcode" : "Direct play"}
            </span>
          }
        />
        <Row k="Player size" v={playerSize} />
        {plan?.bitrate ? (
          <Row k="Source target" v={formatBitrate(plan.bitrate)} />
        ) : null}
      </Section>

      {usingHls && (
        <Section title="Now">
          <Row k="Current level" v={levelRes} />
          <Row
            k="Level bitrate"
            v={hlsStats.level ? formatBitrate(hlsStats.level.bitrate) : null}
          />
          <Row k="Buffer ahead" v={`${hlsStats.bufferAhead.toFixed(1)} s`} />
          <Row
            k="Dropped frames"
            v={`${hlsStats.droppedFrames} / ${hlsStats.totalFrames}`}
          />
        </Section>
      )}
    </div>
  );
};
