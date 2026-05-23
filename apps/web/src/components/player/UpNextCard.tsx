import { Play } from "lucide-react";
import { episodeStillUrl, formatRuntime, cn } from "@/lib/utils";
import type { BaseItemDto } from "@/lib/api";
import { ticksToMinutes } from "@/lib/api";

type Props = {
  episode: BaseItemDto;
  onPlay?: () => void;
};

export const UpNextCard = ({ episode, onPlay }: Props) => {
  const img = episodeStillUrl(episode, "w500");
  const runtime = formatRuntime(ticksToMinutes(episode.RunTimeTicks));
  const season = episode.ParentIndexNumber;
  const ep = episode.IndexNumber;
  const watched = episode.UserData?.Played;
  const progressPct = !watched
    ? Math.max(0, Math.min(100, episode.UserData?.PlayedPercentage ?? 0))
    : 0;
  const epLabel =
    season !== undefined && ep !== undefined
      ? `S${season} · E${ep}`
      : ep !== undefined
        ? `E${ep}`
        : null;

  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={!onPlay}
      className={cn(
        "group block w-full overflow-hidden rounded-sm border border-strata-paper/12 bg-strata-paper/[0.03] text-left transition",
        onPlay &&
          "hover:border-strata-paper/30 hover:bg-strata-paper/[0.06] active:scale-[0.99] active:border-strata-paper/40",
        !onPlay && "opacity-70",
      )}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-strata-bg">
        {img && (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.02] group-hover:opacity-100"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-strata-bg/85 via-strata-bg/15 to-transparent" />
        <div className="absolute left-3 top-3">
          <span className="chip chip-default font-mono">Up next</span>
        </div>
        {onPlay && (
          <div className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-strata-paper/15 text-strata-paper opacity-0 backdrop-blur transition group-hover:opacity-100">
            <Play className="h-3.5 w-3.5 translate-x-px" />
          </div>
        )}
        {progressPct > 0 && (
          <div
            className="absolute inset-x-0 bottom-0 h-[3px] bg-strata-paper/15"
            aria-hidden
          >
            <div
              className="h-full bg-strata-accent"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>
      <div className="space-y-1 px-3 py-2.5">
        {epLabel && (
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-strata-paper/55">
            {epLabel}
            {runtime ? ` · ${runtime}` : null}
          </div>
        )}
        <div className="line-clamp-1 font-display text-sm italic text-strata-paper">
          {episode.Name ?? "Episode"}
        </div>
      </div>
    </button>
  );
};
