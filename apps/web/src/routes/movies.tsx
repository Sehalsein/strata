import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { listMovies, ticksToMinutes, type BaseItemDto } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { cn, posterUrl } from "@/lib/utils";
import { useHoverAmbient } from "@/strata/ambient";
import { Poster } from "@/strata/Poster";
import { paletteFor } from "@/strata/theme";

type SortKey = "newest" | "title" | "oldest";
type ViewMode = "grid" | "list";

const fmtRuntime = (m: number | null): string => {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h ? `${h}h ${min}m` : `${min}m`;
};

const yearOf = (m: BaseItemDto): string | null => {
  if (m.ProductionYear) return String(m.ProductionYear);
  if (m.PremiereDate) return m.PremiereDate.slice(0, 4);
  return null;
};

const dateSortKey = (m: BaseItemDto): string =>
  m.PremiereDate ?? (m.ProductionYear ? `${m.ProductionYear}-01-01` : "");

export const MoviesPage = () => {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;
  return <MoviesInner />;
};

const MoviesInner = () => {
  const movies = useQuery({
    queryKey: ["movies-list"],
    queryFn: listMovies,
  });
  const [sort, setSort] = useState<SortKey>("newest");
  const [view, setView] = useState<ViewMode>("grid");

  const list = (movies.data ?? []).slice();
  if (sort === "title")
    list.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
  else if (sort === "oldest")
    list.sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b)));

  return (
    <div className="anim-fade-in mx-auto max-w-[1680px] px-8 pb-20 pt-10 lg:px-12">
      <CollectionMasthead
        chapter="I"
        title="Films"
        sub="The Catalog of Motion Pictures"
        count={list.length}
      />

      <Toolbar
        sort={sort}
        setSort={setSort}
        view={view}
        setView={setView}
        count={list.length}
      />

      {movies.isLoading ? (
        <Grid view={view}>
          {Array.from({ length: 14 }).map((_, i) => (
            <SkeletonItem key={i} view={view} />
          ))}
        </Grid>
      ) : list.length === 0 ? (
        <EmptyCard />
      ) : view === "grid" ? (
        <Grid view="grid">
          {list.map((m, idx) => (
            <FilmCard
              key={m.Id!}
              id={m.Id!}
              title={m.Name ?? "Untitled"}
              year={yearOf(m)}
              runtime={fmtRuntime(ticksToMinutes(m.RunTimeTicks))}
              to={`/movies/${m.Id}`}
              idx={idx + 1}
            />
          ))}
        </Grid>
      ) : (
        <FilmList items={list} />
      )}
    </div>
  );
};

/* ─── Collection masthead — used by both films and series pages ─── */
export const CollectionMasthead = ({
  chapter,
  title,
  sub,
  count,
}: {
  chapter: string;
  title: string;
  sub: string;
  count: number;
}) => (
  <header className="mb-12 flex flex-col gap-6">
    <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.32em] text-strata-text/45">
      <span>Chapter {chapter}</span>
      <span className="h-px flex-1 bg-strata-text/15" />
      <span>№ {String(count).padStart(3, "0")} entries</span>
    </div>
    <div className="flex flex-wrap items-baseline justify-between gap-6">
      <h1
        className="font-display text-strata-paper"
        style={{
          fontSize: "clamp(64px, 8vw, 128px)",
          lineHeight: "0.9",
          fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
          letterSpacing: "-0.045em",
          marginTop: "-0.05em",
        }}
      >
        {title}
      </h1>
      <div className="flex flex-col items-end gap-1 text-right">
        <span className="font-editorial text-[20px] text-strata-text/65">
          {sub}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/35">
          Curated by hand
        </span>
      </div>
    </div>
  </header>
);

const Toolbar = ({
  sort,
  setSort,
  view,
  setView,
  count,
}: {
  sort: SortKey;
  setSort: (s: SortKey) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  count: number;
}) => (
  <div className="sticky top-[112px] z-20 mb-10 -mx-8 flex flex-wrap items-center gap-4 border-y rule-thin bg-strata-bg/85 px-8 py-3 backdrop-blur-md lg:-mx-12 lg:px-12">
    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/55">
      Sort by
    </span>
    {(
      [
        ["newest", "Newest"],
        ["title", "A–Z"],
        ["oldest", "Oldest"],
      ] as Array<[SortKey, string]>
    ).map(([key, label]) => (
      <BracketTab key={key} active={sort === key} onClick={() => setSort(key)}>
        {label}
      </BracketTab>
    ))}
    <div className="flex-1" />
    <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/35 sm:inline">
      Showing {count}
    </span>
    <span className="text-strata-text/15">|</span>
    <ViewToggle
      mode="grid"
      active={view === "grid"}
      onClick={() => setView("grid")}
    />
    <ViewToggle
      mode="list"
      active={view === "list"}
      onClick={() => setView("list")}
    />
  </div>
);

const BracketTab = ({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "group relative cursor-pointer border-none bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors",
      active ? "text-strata-paper" : "text-strata-text/55 hover:text-strata-paper",
    )}
  >
    <span
      className={cn(
        "absolute inset-0 inline-flex items-center justify-between transition-opacity",
        active ? "opacity-100" : "opacity-0 group-hover:opacity-60",
      )}
    >
      <span className="text-strata-accent">[</span>
      <span className="text-strata-accent">]</span>
    </span>
    <span className="px-1.5">{children}</span>
  </button>
);

const ViewToggle = ({
  mode,
  active,
  onClick,
}: {
  mode: ViewMode;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    aria-label={mode}
    className={cn(
      "inline-flex h-7 w-7 items-center justify-center border cursor-pointer transition-colors",
      active
        ? "border-strata-paper bg-strata-paper text-strata-bg"
        : "border-strata-text/20 bg-transparent text-strata-text/55 hover:border-strata-paper/60 hover:text-strata-paper",
    )}
  >
    {mode === "grid" ? (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <rect x="1" y="1" width="4" height="4" />
        <rect x="7" y="1" width="4" height="4" />
        <rect x="1" y="7" width="4" height="4" />
        <rect x="7" y="7" width="4" height="4" />
      </svg>
    ) : (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M2 3h8M2 6h8M2 9h8" strokeLinecap="round" />
      </svg>
    )}
  </button>
);

const Grid = ({
  children,
  view,
}: {
  children: React.ReactNode;
  view: ViewMode;
}) =>
  view === "grid" ? (
    <div
      className="grid justify-start gap-x-6 gap-y-12"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
      }}
    >
      {children}
    </div>
  ) : (
    <div className="flex flex-col">{children}</div>
  );

const FilmCard = ({
  id,
  title,
  year,
  runtime,
  to,
  idx,
}: {
  id: string;
  title: string;
  year: string | null;
  runtime: string;
  to: string;
  idx: number;
}) => {
  const ambient = useHoverAmbient(id);
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      onPointerEnter={ambient.onPointerEnter}
      onPointerLeave={ambient.onPointerLeave}
    >
      <Link to={to as never} className="block no-underline">
        <div className="overflow-hidden">
          <Poster
            id={id}
            title={title}
            imageUrl={posterUrl(id, "w342")}
            year={year}
            width={190}
            radius={2}
            showBadges={false}
            showTitle={false}
          />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/35">
            № {String(idx).padStart(3, "0")}
          </span>
          {year && (
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/45">
              {year}
            </span>
          )}
        </div>
        <div
          className="mt-1 truncate font-display text-[16px] leading-tight text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 30, "SOFT" 50',
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>
        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/35">
          {runtime}
        </div>
      </Link>
    </motion.div>
  );
};

const FilmList = ({ items }: { items: BaseItemDto[] }) => (
  <div className="border-t rule-thin">
    {items.map((m, idx) => (
      <FilmRow
        key={m.Id!}
        id={m.Id!}
        title={m.Name ?? "Untitled"}
        year={yearOf(m)}
        runtime={fmtRuntime(ticksToMinutes(m.RunTimeTicks))}
        to={`/movies/${m.Id}`}
        idx={idx + 1}
      />
    ))}
  </div>
);

const FilmRow = ({
  id,
  title,
  year,
  runtime,
  to,
  idx,
}: {
  id: string;
  title: string;
  year: string | null;
  runtime: string;
  to: string;
  idx: number;
}) => {
  const ambient = useHoverAmbient(id);
  const palette = paletteFor(id);
  const thumb = posterUrl(id, "w342");
  return (
    <Link
      to={to as never}
      onPointerEnter={ambient.onPointerEnter}
      onPointerLeave={ambient.onPointerLeave}
      className="group flex items-center gap-6 border-b rule-thin py-4 no-underline transition-colors hover:bg-strata-paper/[0.02]"
    >
      <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/35">
        № {String(idx).padStart(3, "0")}
      </span>
      <div className="relative h-12 w-9 shrink-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}
        />
        {thumb && (
          <img
            src={thumb}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <div
        className="flex-1 truncate font-display text-[22px] leading-tight text-strata-paper"
        style={{
          fontVariationSettings: '"opsz" 36, "SOFT" 50',
          letterSpacing: "-0.025em",
        }}
      >
        {title}
      </div>
      <span className="hidden w-24 shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/55 sm:inline">
        {runtime}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
        {year ?? "—"}
      </span>
      <span className="ml-2 font-mono text-[12px] text-strata-text/30 transition-all group-hover:translate-x-1 group-hover:text-strata-accent">
        →
      </span>
    </Link>
  );
};

const SkeletonItem = ({ view }: { view: ViewMode }) =>
  view === "grid" ? (
    <div className="w-[190px]">
      <div className="skeleton h-[285px] w-[190px]" />
      <div className="skeleton mt-3 h-3 w-3/4" />
      <div className="skeleton mt-1.5 h-2.5 w-1/2" />
    </div>
  ) : (
    <div className="flex items-center gap-6 border-b rule-thin py-4">
      <div className="skeleton h-3 w-12" />
      <div className="skeleton h-12 w-9" />
      <div className="skeleton h-4 flex-1" />
      <div className="skeleton h-3 w-16" />
    </div>
  );

const EmptyCard = () => (
  <div className="border-y rule-heavy py-20 text-center">
    <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-text/45">
      Catalog empty
    </div>
    <div className="mx-auto my-3 h-px w-10 bg-strata-accent" />
    <div
      className="font-display text-[36px] text-strata-paper"
      style={{
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        letterSpacing: "-0.03em",
      }}
    >
      No films filed.
    </div>
    <p className="mx-auto mt-3 max-w-md font-editorial text-[16px] text-strata-text/55">
      Add a movies library in the Jellyfin admin panel to begin populating your motion-picture archive.
    </p>
  </div>
);
