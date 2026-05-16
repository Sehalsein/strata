import { useMemo, useState } from "react";
import { cn, formatTime } from "@/lib/utils";
import type { BaseItemDto } from "@/lib/api";
import type { Chapter } from "./types";
import { UpNextCard } from "./UpNextCard";

type Tab = "chapters" | "cast" | "notes";

type Props = {
  visible: boolean;
  chapters: Chapter[];
  currentTime: number;
  onSeek: (sec: number) => void;
  nextEpisode: BaseItemDto | null;
  currentItem: BaseItemDto;
  onPlayNext?: () => void;
};

const findActive = (chapters: Chapter[], time: number): number => {
  if (chapters.length === 0) return -1;
  let idx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.startSeconds <= time) idx = i;
    else break;
  }
  return idx;
};

export const ChaptersRail = ({
  visible,
  chapters,
  currentTime,
  onSeek,
  nextEpisode,
  currentItem,
  onPlayNext,
}: Props) => {
  const hasChapters = chapters.length > 0;
  const [tab, setTab] = useState<Tab>(hasChapters ? "chapters" : "cast");

  const activeIdx = useMemo(
    () => findActive(chapters, currentTime),
    [chapters, currentTime],
  );

  const cast = (currentItem.People ?? []).filter(
    (p) => p.Type === "Actor",
  );

  return (
    <aside
      className={cn(
        "relative hidden h-full flex-col border-l border-strata-paper/10 bg-strata-bg/95 backdrop-blur transition-opacity duration-300 lg:flex",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex items-center gap-1 px-4 pt-4">
        <TabButton
          active={tab === "chapters"}
          disabled={!hasChapters}
          onClick={() => setTab("chapters")}
        >
          Chapters
        </TabButton>
        <TabButton
          active={tab === "cast"}
          disabled={cast.length === 0}
          onClick={() => setTab("cast")}
        >
          Cast
        </TabButton>
        <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
          Notes
        </TabButton>
      </div>

      <div className="strata-scrollbar flex-1 overflow-y-auto px-2 py-3">
        {tab === "chapters" && hasChapters && (
          <ul className="space-y-px">
            {chapters.map((c, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onSeek(c.startSeconds)}
                  className={cn(
                    "group flex w-full items-center justify-between gap-3 rounded-sm border-l-2 px-3 py-2 text-left transition",
                    i === activeIdx
                      ? "border-strata-accent bg-strata-paper/[0.05]"
                      : "border-transparent hover:bg-strata-paper/[0.03]",
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    {i === activeIdx && (
                      <span className="anim-pulse-dot inline-block h-1.5 w-1.5 flex-none rounded-full bg-strata-accent" />
                    )}
                    <span
                      className={cn(
                        "truncate font-sans text-sm",
                        i === activeIdx
                          ? "text-strata-paper"
                          : "text-strata-paper/75 group-hover:text-strata-paper",
                      )}
                    >
                      {c.name}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-strata-paper/50">
                    {formatTime(c.startSeconds)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {tab === "chapters" && !hasChapters && (
          <EmptyState>No chapter data for this title.</EmptyState>
        )}

        {tab === "cast" && cast.length > 0 && (
          <ul className="space-y-1">
            {cast.slice(0, 20).map((p) => (
              <li
                key={`${p.Id}-${p.Name}`}
                className="flex items-baseline justify-between gap-3 px-3 py-1.5"
              >
                <span className="truncate text-sm text-strata-paper">
                  {p.Name}
                </span>
                {p.Role && (
                  <span className="truncate font-editorial text-xs text-strata-paper/55">
                    {p.Role}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {tab === "cast" && cast.length === 0 && (
          <EmptyState>No cast metadata.</EmptyState>
        )}

        {tab === "notes" && (
          <div className="px-3 py-2 text-sm leading-relaxed text-strata-paper/75">
            {currentItem.Overview ? (
              <p>{currentItem.Overview}</p>
            ) : (
              <EmptyState>No synopsis on file.</EmptyState>
            )}
          </div>
        )}
      </div>

      {nextEpisode && (
        <div className="border-t border-strata-paper/10 px-3 py-3">
          <UpNextCard episode={nextEpisode} onPlay={onPlayNext} />
        </div>
      )}
    </aside>
  );
};

const TabButton = ({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "relative rounded-sm px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition",
      active
        ? "text-strata-paper"
        : "text-strata-paper/45 hover:text-strata-paper/80",
      disabled && "cursor-not-allowed opacity-40 hover:text-strata-paper/45",
    )}
  >
    {children}
    {active && (
      <span className="absolute inset-x-3 -bottom-px h-px bg-strata-accent" />
    )}
  </button>
);

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3 py-6 text-center font-editorial text-sm text-strata-paper/45">
    {children}
  </div>
);
