import { useMemo, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  listMovies,
  listShows,
  continueWatching,
  ticksToMinutes,
  ticksToSeconds,
  type BaseItemDto,
} from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { paletteFor, opusFor, volumeFor } from "@/strata/theme";
import { posterUrl, backdropUrl, cn } from "@/lib/utils";
import { Skeleton } from "@/strata/primitives";
import { Poster } from "@/strata/Poster";
import { usePageAmbient, useHoverAmbient } from "@/strata/ambient";

type Featured = {
  id: string;
  title: string;
  backdrop: string | null;
  year: string | null;
  runtime: number | null;
  score: number | null;
  to: string;
  detailTo: string;
};

const fmtRuntime = (m: number | null): string => {
  if (!m) return "";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h ? `${h}h ${min}m` : `${min}m`;
};

export const HomePage = () => {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;
  return <HomeInner />;
};

const HomeInner = () => {
  const movies = useQuery({
    queryKey: ["movies-list"],
    queryFn: listMovies,
  });
  const shows = useQuery({
    queryKey: ["shows-list"],
    queryFn: listShows,
  });
  const cont = useQuery({
    queryKey: ["continue-watching"],
    queryFn: () => continueWatching(),
  });

  const isLoading = movies.isLoading || shows.isLoading || cont.isLoading;
  const movieList = movies.data ?? [];
  const showList = shows.data ?? [];
  const continueList = cont.data ?? [];

  const featuredSource = movieList[0] ?? null;
  const featured: Featured | null = featuredSource?.Id
    ? {
        id: featuredSource.Id,
        title: featuredSource.Name ?? "Untitled",
        backdrop:
          backdropUrl(featuredSource.Id) ?? posterUrl(featuredSource.Id, "original"),
        year: yearFor(featuredSource),
        runtime: ticksToMinutes(featuredSource.RunTimeTicks),
        score: featuredSource.CommunityRating
          ? Math.round(featuredSource.CommunityRating * 10)
          : null,
        to: `/watch/${featuredSource.Id}`,
        detailTo: `/movies/${featuredSource.Id}`,
      }
    : null;

  usePageAmbient(featured?.id ?? null, 0.9);

  const continueItems = useMemo(
    () =>
      continueList
        .filter((c) => c.Id)
        .map((c) => {
          const positionSeconds =
            ticksToSeconds(c.UserData?.PlaybackPositionTicks) ?? 0;
          const durationSeconds = ticksToSeconds(c.RunTimeTicks) ?? 0;
          return {
            id: c.Id!,
            title: c.Name ?? "Untitled",
            runtime: ticksToMinutes(c.RunTimeTicks),
            progress:
              durationSeconds > 0 ? positionSeconds / durationSeconds : 0,
            secondsLeft: Math.max(0, durationSeconds - positionSeconds),
            to: `/watch/${c.Id}`,
            detailTo:
              c.Type === "Episode"
                ? `/shows/${c.SeriesId ?? c.Id}`
                : `/movies/${c.Id}`,
          };
        }),
    [continueList],
  );

  const recentMovies = movieList.slice(0, 16);
  const recentShows = showList.slice(0, 16);

  if (isLoading) return <HomeSkeleton />;

  const isEmpty = movieList.length === 0 && showList.length === 0;
  if (isEmpty) return <EmptyState />;

  return (
    <div className="-mt-[112px]">
      {featured && (
        <Hero
          featured={featured}
          totalFilms={movieList.length}
          totalShows={showList.length}
        />
      )}

      <div className="relative z-10 flex flex-col gap-24 px-8 pb-20 pt-16 lg:px-12">
        <CatalogMarquee
          films={movieList.length}
          shows={showList.length}
          watching={continueItems.length}
        />

        {continueItems.length > 0 && <ContinueRow items={continueItems} />}

        {recentMovies.length > 0 && (
          <PosterShelf
            chapter="I"
            label="Films, Recently Filed"
            sub={`${movieList.length} titles on the shelf`}
            items={recentMovies.map((m) => ({
              id: m.Id!,
              title: m.Name ?? "Untitled",
              year: yearFor(m),
              meta: ticksToMinutes(m.RunTimeTicks)
                ? fmtRuntime(ticksToMinutes(m.RunTimeTicks))
                : null,
              to: `/movies/${m.Id}`,
            }))}
            cta={
              movieList.length > recentMovies.length
                ? { label: "Browse all films", to: "/movies" }
                : undefined
            }
          />
        )}
        {recentShows.length > 0 && (
          <PosterShelf
            chapter="II"
            label="Series & Serials"
            sub={`${showList.length} ongoing or complete`}
            items={recentShows.map((s) => ({
              id: s.Id!,
              title: s.Name ?? "Untitled",
              year: yearFor(s),
              meta: null,
              to: `/shows/${s.Id}`,
            }))}
            cta={
              showList.length > recentShows.length
                ? { label: "Browse all series", to: "/shows" }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
};

const yearFor = (item: BaseItemDto): string | null => {
  if (item.ProductionYear) return String(item.ProductionYear);
  if (item.PremiereDate) return item.PremiereDate.slice(0, 4);
  return null;
};

/* ────────────────────────── Hero ────────────────────────── */

const Hero = ({
  featured,
  totalFilms,
  totalShows,
}: {
  featured: Featured;
  totalFilms: number;
  totalShows: number;
}) => {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 600], reduce ? [0, 0] : [0, 100]);
  const bgScale = useTransform(scrollY, [0, 600], reduce ? [1, 1] : [1.04, 1.16]);
  const contentY = useTransform(scrollY, [0, 400], reduce ? [0, 0] : [0, -30]);
  const contentOp = useTransform(scrollY, [0, 500], [1, 0.2]);

  const palette = paletteFor(featured.id);
  const opus = opusFor(featured.id);
  const volume = volumeFor(featured.id);

  const heroStyle = {
    "--c1": palette[0],
    "--c2": palette[1],
    "--c3": palette[2],
  } as CSSProperties;

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{ ...heroStyle, height: "100vh", minHeight: 760 }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${palette[1]} 0%, ${palette[0]} 100%)`,
        }}
      />

      <motion.div style={{ y: bgY, scale: bgScale }} className="absolute inset-0">
        {featured.backdrop && (
          <img
            src={featured.backdrop}
            alt=""
            className="h-full w-full object-cover"
            style={{ objectPosition: "65% center" }}
          />
        )}
      </motion.div>

      <div className="absolute inset-0 [background:linear-gradient(95deg,rgb(12_10_8/0.96)_0%,rgb(12_10_8/0.85)_28%,rgb(12_10_8/0.35)_55%,transparent_85%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] [background:linear-gradient(180deg,transparent_0%,var(--color-strata-bg)_92%)]" />
      <div className="grain-paper absolute inset-0 opacity-[0.6] mix-blend-overlay" />

      <motion.div
        style={{ opacity: contentOp }}
        className="absolute right-8 top-[152px] hidden flex-col items-end gap-3 text-right lg:flex lg:right-12"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-paper/65">
          Feature Presentation
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/45">
          <span>Vol. {volume}</span>
          <span className="text-strata-paper/25">·</span>
          <span>Opus № {opus}</span>
        </div>
        <div className="mt-4 h-px w-12 bg-strata-paper/30" />
        <div className="font-editorial text-[14px] text-strata-paper/55">
          presented in
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/75">
          4K · HDR · Atmos
        </div>
      </motion.div>

      <motion.div
        style={{ y: contentY, opacity: contentOp }}
        className="absolute inset-x-0 bottom-0 px-8 pb-28 lg:px-12 lg:pb-32"
      >
        <motion.div
          initial={reduce ? false : "hidden"}
          animate="show"
          variants={heroStagger}
          className="flex max-w-[920px] flex-col gap-7"
        >
          <motion.div
            variants={heroItem}
            className="flex items-center gap-4"
          >
            <span className="h-px w-10 bg-strata-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-strata-paper/85">
              Tonight in Repertory
            </span>
            <span className="anim-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-strata-accent" />
          </motion.div>

          <motion.h1
            variants={heroItem}
            className="font-display text-strata-paper"
            style={{
              fontSize: "clamp(64px, 9vw, 148px)",
              lineHeight: "0.92",
              fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
              letterSpacing: "-0.045em",
              marginTop: "-0.05em",
              marginBottom: "-0.05em",
            }}
          >
            {featured.title}
          </motion.h1>

          <motion.div
            variants={heroItem}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-strata-paper/70"
          >
            {featured.year && <span>Anno {featured.year}</span>}
            {featured.year && featured.runtime && <Dot />}
            {featured.runtime && <span>{fmtRuntime(featured.runtime)}</span>}
            <Dot />
            <span className="font-editorial normal-case tracking-normal text-[14px] text-strata-paper/85">
              a motion picture
            </span>
            {featured.score !== null && (
              <>
                <Dot />
                <span className="text-strata-accent-2">★ {featured.score}/100</span>
              </>
            )}
          </motion.div>

          <motion.div
            variants={heroItem}
            className="mt-2 flex flex-wrap items-center gap-3"
          >
            <motion.div
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 18 }}
            >
              <Link to={featured.to as never} className="btn-play">
                <PlayIcon className="h-3.5 w-3.5" />
                Begin
              </Link>
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 18 }}
            >
              <Link to={featured.detailTo as never} className="btn-glass">
                <InfoIcon className="h-3.5 w-3.5" />
                Programme
              </Link>
            </motion.div>
            <span className="ml-2 hidden font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/40 sm:inline">
              Press <kbd className="rounded-sm border border-strata-paper/20 bg-strata-paper/5 px-1 py-0.5 text-[9px]">↵</kbd> to begin
            </span>
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.div
        style={{ opacity: contentOp }}
        className="absolute inset-x-0 bottom-0 z-10"
      >
        <div className="mx-auto flex max-w-[1680px] items-end justify-between gap-6 border-t rule-thin px-8 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/55 lg:px-12">
          <span className="flex items-center gap-3">
            <span className="text-strata-paper/30">In Your Catalog</span>
            <span className="text-strata-paper/30">/</span>
            <span className="text-strata-paper">
              {String(totalFilms).padStart(3, "0")} Films
            </span>
            <span className="text-strata-paper/30">·</span>
            <span className="text-strata-paper">
              {String(totalShows).padStart(3, "0")} Series
            </span>
          </span>
          <span className="hidden text-strata-paper/30 md:inline">
            Scroll for the index ↓
          </span>
        </div>
      </motion.div>
    </section>
  );
};

const heroStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.18 } },
};
const heroItem: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 220, damping: 26 },
  },
};

const Dot = () => <span className="text-strata-paper/25">·</span>;

const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 14 14" fill="currentColor" className={className}>
    <polygon points="3,2 12,7 3,12" />
  </svg>
);

const InfoIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 14 14" fill="none" className={className}>
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="7" cy="4.6" r="0.8" fill="currentColor" />
    <path
      d="M7 6.6v3.6"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/* ────────────────────────── Catalog marquee ────────────────────────── */

const CatalogMarquee = ({
  films,
  shows,
  watching,
}: {
  films: number;
  shows: number;
  watching: number;
}) => {
  const tokens = useMemo(
    () => [
      `№ ${String(films).padStart(3, "0")} Films`,
      "·",
      `№ ${String(shows).padStart(3, "0")} Series`,
      "·",
      `${watching} in progress`,
      "·",
      "All formats",
      "·",
      "Local Archive",
      "·",
      "Hand-curated",
      "·",
      "No algorithm, no ads",
    ],
    [films, shows, watching],
  );

  return (
    <div className="overflow-hidden border-y rule-thin -mx-8 lg:-mx-12">
      <div className="anim-marquee flex w-max gap-8 whitespace-nowrap py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-strata-text/55">
        {[...tokens, ...tokens, ...tokens].map((t, i) => (
          <span key={i} className={t === "·" ? "text-strata-accent" : undefined}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
};

/* ────────────────────────── Section heading ────────────────────────── */

const SectionHeader = ({
  chapter,
  label,
  sub,
  cta,
}: {
  chapter?: string;
  label: string;
  sub?: string;
  cta?: { label: string; to: string };
}) => (
  <div className="flex flex-col gap-5">
    <div className="flex items-baseline justify-between gap-6">
      <div className="flex items-baseline gap-5">
        {chapter && (
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-strata-text/40">
            CH. {chapter}
          </span>
        )}
        <h2
          className="font-display font-normal leading-none text-strata-paper"
          style={{
            fontSize: "clamp(28px, 3.4vw, 52px)",
            fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
            letterSpacing: "-0.035em",
          }}
        >
          {label}
        </h2>
      </div>
      {cta && (
        <Link
          to={cta.to as never}
          className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/55 no-underline hover:text-strata-paper"
        >
          {cta.label}
          <span className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      )}
    </div>
    <div className="flex items-center gap-4">
      <div className="h-px flex-1 bg-strata-text/15" />
      {sub && (
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
          {sub}
        </div>
      )}
    </div>
  </div>
);

/* ────────────────────────── Continue Watching ────────────────────────── */

const ContinueThumb = ({
  id,
  title,
  progress,
}: {
  id: string;
  title: string;
  progress: number;
}) => {
  const palette = paletteFor(id);
  const img = backdropUrl(id) ?? posterUrl(id, "w780");
  return (
    <div className="relative aspect-[16/9] overflow-hidden ring-1 ring-strata-text/10 transition-shadow duration-300 group-hover:ring-strata-paper/40">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 100%)`,
        }}
      />
      {img && (
        <img
          src={img}
          alt={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: "50% 30%" }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_50%,rgb(0_0_0/0.55)_100%)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-1.5 w-1.5 rounded-[1px] bg-strata-paper/70" />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/55">
        <div
          className="h-full bg-strata-accent"
          style={{ width: `${Math.max(2, progress * 100)}%` }}
        />
      </div>
    </div>
  );
};

const ContinueRow = ({
  items,
}: {
  items: Array<{
    id: string;
    title: string;
    runtime: number | null;
    progress: number;
    secondsLeft: number;
    to: string;
    detailTo: string;
  }>;
}) => (
  <motion.section
    initial="hidden"
    whileInView="show"
    viewport={{ once: true, amount: 0.15 }}
    variants={shelfContainer}
    className="flex flex-col gap-8"
  >
    <motion.div variants={shelfItem}>
      <SectionHeader
        label="In Progress"
        sub={`${items.length} unfinished`}
      />
    </motion.div>
    <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
      {items.map((it, idx) => (
        <motion.div key={it.id} variants={shelfItem}>
          <ContinueCard {...it} idx={idx + 1} />
        </motion.div>
      ))}
    </div>
  </motion.section>
);

const ContinueCard = ({
  id,
  title,
  runtime,
  progress,
  secondsLeft,
  to,
  idx,
}: {
  id: string;
  title: string;
  runtime: number | null;
  progress: number;
  secondsLeft: number;
  to: string;
  detailTo: string;
  idx: number;
}) => {
  const navigate = useNavigate();
  const ambient = useHoverAmbient(id);
  const minLeft = Math.max(1, Math.round(secondsLeft / 60));
  return (
    <motion.div
      onPointerEnter={ambient.onPointerEnter}
      onPointerLeave={ambient.onPointerLeave}
      onClick={() => navigate({ to: to as never })}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate({ to: to as never });
      }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className="group flex cursor-pointer flex-col gap-3"
    >
      <ContinueThumb id={id} title={title} progress={progress} />
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/35">
          № {String(idx).padStart(2, "0")}
        </span>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-accent">
          {minLeft}m to go
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div
          className="font-display text-[18px] leading-tight text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 36, "SOFT" 50',
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">
          {runtime ? fmtRuntime(runtime) : "—"} · {Math.round(progress * 100)}% watched
        </div>
      </div>
    </motion.div>
  );
};

/* ────────────────────────── Poster shelf ────────────────────────── */

const PosterShelf = ({
  chapter,
  label,
  sub,
  items,
  cta,
}: {
  chapter?: string;
  label: string;
  sub?: string;
  items: Array<{
    id: string;
    title: string;
    year: string | null;
    meta: string | null;
    to: string;
  }>;
  cta?: { label: string; to: string };
}) => (
  <motion.section
    initial="hidden"
    whileInView="show"
    viewport={{ once: true, amount: 0.1 }}
    variants={shelfContainer}
    className="flex flex-col gap-8"
  >
    <motion.div variants={shelfItem}>
      <SectionHeader chapter={chapter} label={label} sub={sub} cta={cta} />
    </motion.div>
    <div
      className="row-mask no-scrollbar -mx-3 flex gap-6 overflow-x-auto px-3 pb-3"
      style={{ scrollSnapType: "x proximity" }}
    >
      {items.map((it, idx) => (
        <motion.div key={it.id} variants={shelfItem}>
          <PosterItem item={it} idx={idx + 1} />
        </motion.div>
      ))}
    </div>
  </motion.section>
);

const PosterItem = ({
  item,
  idx,
}: {
  item: {
    id: string;
    title: string;
    year: string | null;
    meta: string | null;
    to: string;
  };
  idx: number;
}) => {
  const ambient = useHoverAmbient(item.id);
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      onPointerEnter={ambient.onPointerEnter}
      onPointerLeave={ambient.onPointerLeave}
      style={{ scrollSnapAlign: "start" }}
    >
      <Link to={item.to as never} className="block w-[200px] shrink-0 no-underline">
        <div className="overflow-hidden">
          <Poster
            id={item.id}
            title={item.title}
            imageUrl={posterUrl(item.id, "w342")}
            year={item.year}
            width={200}
            radius={2}
            showBadges={false}
            showTitle={false}
          />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/35">
            № {String(idx).padStart(2, "0")}
          </span>
          {item.year && (
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/45">
              {item.year}
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
          {item.title}
        </div>
        {item.meta && (
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/35">
            {item.meta}
          </div>
        )}
      </Link>
    </motion.div>
  );
};

const shelfContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};
const shelfItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 220, damping: 24 },
  },
};

/* ────────────────────────── Empty state ────────────────────────── */

const EmptyState = () => (
  <div className="anim-fade-in flex min-h-[calc(100vh-180px)] items-center justify-center px-8">
    <div className="max-w-[520px] text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-text/45">
        The Archive is Empty
      </div>
      <div className="mx-auto my-4 h-px w-12 bg-strata-accent" />
      <h1
        className="font-display text-strata-paper"
        style={{
          fontSize: "clamp(48px, 6vw, 84px)",
          lineHeight: "0.95",
          fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
          letterSpacing: "-0.04em",
        }}
      >
        Nothing to project tonight.
      </h1>
      <p className="mt-6 font-editorial text-[18px] leading-[1.5] text-strata-text/65">
        Add a library in the Jellyfin admin panel and we&apos;ll thread the reels for you.
      </p>
    </div>
  </div>
);

/* ────────────────────────── Skeleton ────────────────────────── */

const HomeSkeleton = () => (
  <div className="-mt-[112px]">
    <section
      className="relative w-full overflow-hidden"
      style={{ height: "100vh", minHeight: 760 }}
    >
      <div className="absolute inset-0 bg-strata-bg" />
      <div className="absolute inset-0 [background:radial-gradient(65%_70%_at_70%_35%,rgba(232,179,65,0.08),transparent_60%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] [background:linear-gradient(180deg,transparent_0%,var(--color-strata-bg)_92%)]" />
      <div className="absolute inset-x-0 bottom-0 px-8 pb-32 lg:px-12">
        <div className="flex max-w-[920px] flex-col gap-7">
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-[120px] w-[80%]" />
          <Skeleton className="h-3 w-2/3" />
          <div className="mt-3 flex gap-3">
            <Skeleton className="h-12 w-28" />
            <Skeleton className="h-12 w-28" />
          </div>
        </div>
      </div>
    </section>
    <div className="relative z-10 flex flex-col gap-20 px-8 pb-20 pt-16 lg:px-12">
      <ShelfSkeleton cardW={340} cardH={191} count={5} />
      <ShelfSkeleton cardW={200} cardH={300} count={8} />
      <ShelfSkeleton cardW={200} cardH={300} count={8} />
    </div>
  </div>
);

const ShelfSkeleton = ({
  cardW,
  cardH,
  count,
}: {
  cardW: number;
  cardH: number;
  count: number;
}) => (
  <section className="flex flex-col gap-6">
    <Skeleton className="h-8 w-56" />
    <div className="row-mask no-scrollbar flex gap-6 overflow-hidden pb-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="shrink-0" style={{ width: cardW }}>
          <Skeleton style={{ width: cardW, height: cardH }} />
          <Skeleton className="mt-3 h-3 w-3/4" />
          <Skeleton className="mt-1.5 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  </section>
);

void cn;
