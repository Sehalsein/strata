import { useCallback, useEffect, useRef, useState } from "react";
import { cn, formatTime } from "@/lib/utils";
import type { Chapter } from "./types";
import type { TrickplaySource } from "./hooks/useTrickplay";

type Props = {
  duration: number;
  currentTime: number;
  buffered: number;
  chapters: Chapter[];
  trickplay: TrickplaySource | null;
  onSeek: (sec: number) => void;
};

type Hover = {
  pct: number;
  seconds: number;
  chapter: Chapter | null;
};

const findChapter = (chapters: Chapter[], seconds: number): Chapter | null => {
  if (chapters.length === 0) return null;
  let active: Chapter = chapters[0]!;
  for (const c of chapters) {
    if (c.startSeconds <= seconds) active = c;
    else break;
  }
  return active;
};

export const Scrubber = ({
  duration,
  currentTime,
  buffered,
  chapters,
  trickplay,
  onSeek,
}: Props) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState(false);

  const dur = duration > 0 ? duration : 0;
  const progressPct = dur > 0 ? Math.min(100, (currentTime / dur) * 100) : 0;
  const bufferedPct = dur > 0 ? Math.min(100, (buffered / dur) * 100) : 0;

  const computeHover = useCallback(
    (clientX: number): Hover | null => {
      const el = trackRef.current;
      if (!el || dur === 0) return null;
      const rect = el.getBoundingClientRect();
      const pct = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      const seconds = pct * dur;
      return { pct: pct * 100, seconds, chapter: findChapter(chapters, seconds) };
    },
    [chapters, dur],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const next = computeHover(e.clientX);
      if (next) setHover(next);
    },
    [computeHover],
  );

  const onPointerLeave = useCallback(() => {
    if (!dragging) setHover(null);
  }, [dragging]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dur === 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      const next = computeHover(e.clientX);
      if (next) {
        setHover(next);
        onSeek(next.seconds);
      }
    },
    [computeHover, dur, onSeek],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const next = computeHover(e.clientX);
      if (next) onSeek(next.seconds);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      setDragging(false);
    },
    [computeHover, dragging, onSeek],
  );

  // While dragging, keep updating hover position on global pointer move.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const next = computeHover(e.clientX);
      if (next) {
        setHover(next);
        onSeek(next.seconds);
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [computeHover, dragging, onSeek]);

  const tile = hover && trickplay ? trickplay.tileForTime(hover.seconds) : null;
  const TOOLTIP_W = tile ? tile.thumb.w : 160;
  const TOOLTIP_H = tile ? tile.thumb.h : 0;

  // Clamp tooltip x so it stays within the track.
  const tooltipLeft = (() => {
    if (!hover) return 0;
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const hoverX = (hover.pct / 100) * rect.width;
    const min = TOOLTIP_W / 2;
    const max = rect.width - TOOLTIP_W / 2;
    return Math.min(max, Math.max(min, hoverX));
  })();

  return (
    <div className="relative w-full select-none">
      {hover && (
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 flex-col items-center"
          style={{
            left: tooltipLeft,
            bottom: tile ? TOOLTIP_H + 28 : 24,
          }}
        >
          {tile && (
            <div
              className="overflow-hidden rounded-sm border border-strata-paper/20 shadow-2xl"
              style={{
                width: tile.thumb.w,
                height: tile.thumb.h,
                backgroundImage: `url(${tile.url})`,
                backgroundSize: `${tile.size.w}px ${tile.size.h}px`,
                backgroundPosition: `${tile.bgPos.x}px ${tile.bgPos.y}px`,
                backgroundRepeat: "no-repeat",
                backgroundColor: "#000",
              }}
            />
          )}
          <div className="mt-2 flex items-center gap-2 rounded-sm bg-strata-bg/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-strata-paper backdrop-blur">
            <span className="tabular-nums">{formatTime(hover.seconds)}</span>
            {hover.chapter && (
              <>
                <span className="text-strata-paper/40">·</span>
                <span className="font-sans normal-case tracking-normal text-strata-paper/85">
                  {hover.chapter.name}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "group relative h-6 w-full cursor-pointer touch-none",
        )}
      >
        {/* base track */}
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-strata-paper/15 transition-all group-hover:h-[5px]" />
        {/* buffered */}
        <div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-strata-paper/25 transition-all group-hover:h-[5px]"
          style={{ width: `${bufferedPct}%` }}
        />
        {/* progress */}
        <div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-strata-accent transition-all group-hover:h-[5px]"
          style={{ width: `${progressPct}%` }}
        />
        {/* hover marker */}
        {hover && (
          <div
            className="absolute top-1/2 h-[5px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-strata-paper/55"
            style={{ left: `${hover.pct}%` }}
          />
        )}
        {/* chapter ticks */}
        {chapters.map((c, i) => {
          if (dur === 0) return null;
          const left = Math.min(100, (c.startSeconds / dur) * 100);
          if (left <= 0 || left >= 100) return null;
          return (
            <div
              key={i}
              className="absolute top-1/2 h-[5px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-strata-bg/80"
              style={{ left: `${left}%` }}
              aria-hidden
            />
          );
        })}
        {/* knob */}
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-strata-accent shadow-[0_0_0_4px_rgba(232,51,31,0.18)] transition-opacity",
            hover || dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          style={{ left: `${progressPct}%` }}
        />
      </div>
    </div>
  );
};
