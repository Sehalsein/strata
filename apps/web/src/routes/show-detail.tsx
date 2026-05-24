import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "@tanstack/react-router";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import {
  getItem,
  getSeasons,
  getEpisodes,
  getSimilarItems,
  ticksToMinutes,
  type BaseItemDto,
} from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { cn, posterUrl, backdropUrl, episodeStillUrl } from "@/lib/utils";
import { opusFor, paletteFor, volumeFor, type Palette } from "@/strata/theme";
import { CountUp, ProgressBar, Skeleton } from "@/strata/primitives";
import { DetailMotif } from "@/strata/Poster";
import { usePageAmbient } from "@/strata/ambient";
import { useImagePalette } from "@/strata/useImagePalette";
import { CreditsRow } from "@/strata/CreditsRow";
import { WatchlistToggle } from "@/strata/WatchlistToggle";
import { SimilarShelf as SimilarShelfRow } from "@/strata/SimilarShelf";
import { SidebarHeader } from "./movie-detail";

const yearOf = (s: BaseItemDto): string | null => {
  if (s.ProductionYear) return String(s.ProductionYear);
  if (s.PremiereDate) return s.PremiereDate.slice(0, 4);
  return null;
};

export const ShowDetailPage = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;
  return <ShowDetailInner id={id} />;
};

const ShowDetailInner = ({ id }: { id: string }) => {
  const show = useQuery({
    queryKey: ["item", id],
    queryFn: () => getItem(id),
  });
  const seasonsQ = useQuery({
    queryKey: ["seasons", id],
    queryFn: () => getSeasons(id),
  });
  const episodesQ = useQuery({
    queryKey: ["episodes", id],
    queryFn: () => getEpisodes(id),
  });
  const similarQ = useQuery({
    queryKey: ["similar", id],
    queryFn: () => getSimilarItems(id, 12),
  });
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  const backdropImg = backdropUrl(id) ?? posterUrl(id, "original");
  const imgPalette = useImagePalette(backdropImg);
  const activePalette = imgPalette ?? paletteFor(id);
  usePageAmbient(id, 0.95, imgPalette);

  if (show.isLoading || seasonsQ.isLoading || episodesQ.isLoading)
    return <ShowDetailSkeleton />;
  if (!show.data) return <NotFound />;

  const s = show.data;
  const seasons = seasonsQ.data ?? [];
  const episodes = episodesQ.data ?? [];
  const similar = (similarQ.data ?? []).slice(0, 8);
  const cast = s.People ?? [];
  const isFav = Boolean(s.UserData?.IsFavorite);
  const year = yearOf(s);
  const score = s.CommunityRating ? Math.round(s.CommunityRating * 10) : null;
  // Prefer the first season that actually has episodes — Jellyfin
  // commonly lists a "Specials" pseudo-season first with no entries,
  // which would otherwise leave the page looking empty.
  const firstSeasonWithEps = seasons.find((s) =>
    episodes.some((e) => e.ParentIndexNumber === s.IndexNumber),
  )?.IndexNumber;
  const activeSeason =
    selectedSeason ?? firstSeasonWithEps ?? seasons[0]?.IndexNumber ?? 1;
  const visibleEpisodes = episodes.filter(
    (e) => e.ParentIndexNumber === activeSeason,
  );
  const totalEpisodes = episodes.length;
  const seasonsCount = seasons.length;
  const firstEpisode = episodes
    .slice()
    .sort((a, b) =>
      (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) ||
      (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0),
    )[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="-mt-[112px]"
    >
      <DetailHero
        id={s.Id!}
        title={s.Name ?? "Untitled"}
        year={year}
        genres={s.Genres ?? []}
        seasonsCount={seasonsCount}
        episodesCount={totalEpisodes}
        score={score}
        tagline={s.Taglines?.[0] ?? null}
        firstEpisode={firstEpisode ?? null}
        isFav={isFav}
        palette={activePalette}
        backdropImg={backdropImg}
      />

      <div className="relative z-10 mx-auto grid max-w-[1680px] grid-cols-1 gap-x-12 gap-y-14 px-8 pb-20 pt-16 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-12">
        <article className="flex flex-col gap-14">
          {s.Overview && (
            <Synopsis overview={s.Overview ?? ""} genres={s.Genres ?? []} />
          )}

          <EpisodesSection
            seasons={seasons}
            episodes={episodes}
            visibleEpisodes={visibleEpisodes}
            activeSeason={activeSeason}
            onSelect={setSelectedSeason}
            showId={s.Id!}
          />

          {cast.length > 0 && (
            <section className="flex flex-col gap-7">
              <SectionMark
                chapter="III"
                label="Players"
                sub={`${cast.filter((p) => p.Type === "Actor").length || cast.length} on screen`}
              />
              <CreditsRow people={cast} />
            </section>
          )}

          {similar.length > 0 && (
            <section className="flex flex-col gap-8">
              <SectionMark
                chapter={cast.length > 0 ? "IV" : "III"}
                label="In the Same Spirit"
                sub={`${similar.length} adjacent titles`}
              />
              <SimilarShelfRow items={similar} />
            </section>
          )}
        </article>

        <aside className="flex flex-col gap-10">
          <SeasonsCard
            seasons={seasons}
            episodes={episodes}
            activeSeason={activeSeason}
            onSelect={setSelectedSeason}
          />
          {score !== null && <CriticsCard score={score} />}
        </aside>
      </div>
    </motion.div>
  );
};

/* ───────────── Hero ───────────── */

const DetailHero = ({
  id,
  title,
  year,
  genres,
  seasonsCount,
  episodesCount,
  score,
  tagline,
  firstEpisode,
  isFav,
  palette,
  backdropImg,
}: {
  id: string;
  title: string;
  year: string | null;
  genres: string[];
  seasonsCount: number;
  episodesCount: number;
  score: number | null;
  tagline: string | null;
  firstEpisode: BaseItemDto | null;
  isFav: boolean;
  palette: Palette;
  backdropImg: string | null;
}) => {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 600], reduce ? [0, 0] : [0, 90]);
  const bgScale = useTransform(scrollY, [0, 600], reduce ? [1, 1] : [1.03, 1.14]);
  const contentOp = useTransform(scrollY, [0, 500], [1, 0.25]);

  const opus = opusFor(id);
  const volume = volumeFor(id);
  const heroStyle = {
    "--c1": palette[0],
    "--c2": palette[1],
    "--c3": palette[2],
  } as CSSProperties;

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{ ...heroStyle, height: "100vh", minHeight: 780 }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, var(--strata-c2) 0%, var(--strata-c1) 100%)",
        }}
      />
      <motion.div style={{ y: bgY, scale: bgScale }} className="absolute inset-0">
        {backdropImg ? (
          <img
            src={backdropImg}
            alt=""
            className="h-full w-full object-cover"
            style={{ objectPosition: "65% center" }}
          />
        ) : (
          <DetailMotif paletteKey={id} />
        )}
      </motion.div>
      <div className="absolute inset-0 [background:linear-gradient(95deg,rgb(12_10_8/0.96)_0%,rgb(12_10_8/0.85)_28%,rgb(12_10_8/0.4)_55%,transparent_85%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] [background:linear-gradient(180deg,transparent_0%,var(--strata-c2)_92%)]" />
      <div className="grain-paper absolute inset-0 opacity-[0.6] mix-blend-overlay" />

      {/* Right rail */}
      <motion.div
        style={{ opacity: contentOp }}
        className="absolute right-8 top-[152px] hidden flex-col items-end gap-3 text-right lg:flex lg:right-12"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-paper/65">
          Limited Show
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/45">
          <span>Vol. {volume}</span>
          <span className="text-strata-paper/25">·</span>
          <span>Opus № {opus}</span>
        </div>
        <div className="mt-4 h-px w-12 bg-strata-paper/30" />
        <div className="font-editorial text-[14px] text-strata-paper/55">
          in {seasonsCount} {seasonsCount === 1 ? "season" : "seasons"}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/75">
          {episodesCount} episodes
        </div>
      </motion.div>

      <motion.div
        style={{ opacity: contentOp }}
        className="absolute inset-x-0 bottom-0 px-8 pb-28 lg:px-12 lg:pb-32"
      >
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 26, delay: 0.05 }}
          className="flex max-w-[920px] flex-col gap-7"
        >
          <Breadcrumb genre={genres[0] ?? null} />

          <h1
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
            {title}
          </h1>

          {tagline && (
            <p
              className="font-editorial text-[22px] italic text-strata-paper/75"
              style={{ maxWidth: "44ch" }}
            >
              {tagline}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-strata-paper/70">
            {year && <span>Anno {year}</span>}
            {year && <Dot />}
            <span>{seasonsCount} {seasonsCount === 1 ? "season" : "seasons"}</span>
            <Dot />
            <span>{episodesCount} ep</span>
            {genres.slice(0, 2).map((g) => (
              <span key={g} className="flex items-center gap-x-4">
                <Dot />
                <span>{g}</span>
              </span>
            ))}
            <Dot />
            <span className="font-editorial normal-case tracking-normal text-[14px] text-strata-paper/85">
              episodic programme
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            {firstEpisode?.Id ? (
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}>
                <Link to={`/watch/${firstEpisode.Id}` as never} className="btn-play">
                  <PlayIcon className="h-3.5 w-3.5" />
                  Begin S{String(firstEpisode.ParentIndexNumber ?? 1).padStart(2, "0")}·E{String(firstEpisode.IndexNumber ?? 1).padStart(2, "0")}
                </Link>
              </motion.div>
            ) : (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                className="btn-play opacity-50"
                disabled
              >
                <PlayIcon className="h-3.5 w-3.5" />
                Begin
              </motion.button>
            )}
            <WatchlistToggle itemId={id} initialIsFavorite={isFav} />
          </div>
        </motion.div>
      </motion.div>

      <motion.div
        style={{ opacity: contentOp }}
        className="absolute inset-x-0 bottom-0 z-10"
      >
        <div className="mx-auto flex max-w-[1680px] items-end justify-between gap-6 border-t rule-thin px-8 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/55 lg:px-12">
          <span className="flex items-center gap-3">
            <span className="text-strata-paper/30">Filed Under</span>
            <span className="text-strata-paper/30">/</span>
            <span className="text-strata-paper">Shows</span>
            {genres.slice(0, 2).map((g) => (
              <span key={g} className="flex items-center gap-3">
                <span className="text-strata-paper/30">·</span>
                <span className="text-strata-paper">{g}</span>
              </span>
            ))}
          </span>
          <span className="hidden text-strata-paper/30 md:inline">Scroll for the programme ↓</span>
        </div>
      </motion.div>
    </section>
  );
};

const Breadcrumb = ({ genre }: { genre: string | null }) => (
  <div className="flex items-center gap-4">
    <Link
      to="/shows"
      className="group flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-strata-paper/55 no-underline hover:text-strata-paper"
    >
      <span className="transition-transform group-hover:-translate-x-0.5">←</span>
      <span>Shows</span>
    </Link>
    <span className="h-px w-8 bg-strata-paper/25" />
    <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-strata-paper/85">
      Now in Rotation
    </span>
    {genre && (
      <>
        <span className="anim-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-strata-accent" />
        <span className="font-editorial text-[14px] italic text-strata-paper/70">
          {genre.toLowerCase()}
        </span>
      </>
    )}
  </div>
);

const Dot = () => <span className="text-strata-paper/25">·</span>;

/* ───────────── Synopsis ───────────── */

const Synopsis = ({
  overview,
  genres,
}: {
  overview: string;
  genres: string[];
}) => (
  <section className="flex flex-col gap-6">
    <SectionMark chapter="I" label="Programme Notes" />
    <p
      className="max-w-[720px] text-[16px] leading-[1.7] text-strata-text/75"
      style={{ fontFeatureSettings: '"ss01"' }}
    >
      {overview}
    </p>
    {genres.length > 0 && (
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t rule-thin pt-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
          Filed under
        </span>
        {genres.map((g) => (
          <span
            key={g}
            className="border border-strata-text/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/70"
          >
            {g}
          </span>
        ))}
      </div>
    )}
  </section>
);

/* ───────────── Episodes ───────────── */

const EpisodesSection = ({
  seasons,
  episodes,
  visibleEpisodes,
  activeSeason,
  onSelect,
  showId,
}: {
  seasons: BaseItemDto[];
  episodes: BaseItemDto[];
  visibleEpisodes: BaseItemDto[];
  activeSeason: number;
  onSelect: (n: number) => void;
  showId: string;
}) => (
  <section className="flex flex-col gap-6">
    <SectionMark
      chapter="II"
      label="Episodes"
      sub={`${visibleEpisodes.length} in this season`}
    />

    {seasons.length > 1 && (
      <div className="-mx-1 flex flex-wrap items-center gap-1 border-y rule-thin py-3">
        <span className="ml-2 mr-3 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
          Season
        </span>
        {seasons.map((season) => {
          const total = episodes.filter(
            (e) => e.ParentIndexNumber === season.IndexNumber,
          ).length;
          const isActive = season.IndexNumber === activeSeason;
          return (
            <button
              key={season.Id ?? season.IndexNumber}
              onClick={() => onSelect(season.IndexNumber ?? 1)}
              className={cn(
                "group relative cursor-pointer border-none bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors",
                isActive ? "text-strata-paper" : "text-strata-text/55 hover:text-strata-paper",
              )}
            >
              <span
                className={cn(
                  "absolute inset-0 inline-flex items-center justify-between transition-opacity",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60",
                )}
              >
                <span className="text-strata-accent">[</span>
                <span className="text-strata-accent">]</span>
              </span>
              <span className="px-1.5">
                S{String(season.IndexNumber ?? 1).padStart(2, "0")}
                <span className="ml-1.5 text-strata-text/35">· {total}</span>
              </span>
            </button>
          );
        })}
      </div>
    )}

    <div className="flex flex-col">
      {visibleEpisodes.map((ep, i) => (
        <EpisodeRow key={ep.Id} ep={ep} showId={showId} isLast={i === visibleEpisodes.length - 1} />
      ))}
      {visibleEpisodes.length === 0 && (
        <div className="border border-dashed border-strata-text/15 py-10 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-strata-text/45">
          No episodes filed for this season.
        </div>
      )}
    </div>
  </section>
);

const EpisodeRow = ({
  ep,
  showId,
  isLast,
}: {
  ep: BaseItemDto;
  showId: string;
  isLast: boolean;
}) => {
  const stillImg = episodeStillUrl(ep, "w500");
  const playable = Boolean(ep.Id);
  const runtime = ticksToMinutes(ep.RunTimeTicks);
  const palette = paletteFor(showId);
  const watched = ep.UserData?.Played;
  // Jellyfin clears PlayedPercentage on full watch; only show the bar
  // for in-progress episodes.
  const progressPct = !watched
    ? Math.max(0, Math.min(100, ep.UserData?.PlayedPercentage ?? 0))
    : 0;
  // Use `||` so an empty Name/Overview falls back too — `??` only
  // catches null/undefined and Jellyfin sometimes emits "".
  const title = ep.Name?.trim() || `Episode ${ep.IndexNumber ?? "?"}`;
  const overview = ep.Overview?.trim() || "No synopsis on file.";
  const epNum = String(ep.IndexNumber ?? 0).padStart(2, "0");

  return (
    <div
      className={cn(
        "group flex flex-col gap-4 border-t rule-thin py-5 transition-colors sm:grid sm:grid-cols-[48px_minmax(160px,220px)_minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:hover:bg-strata-paper/[0.02]",
        isLast && "border-b",
      )}
    >
      {/* EP number — inline on mobile (alongside title), own column on sm+ */}
      <div className="hidden flex-col items-center gap-1.5 sm:flex">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/35">
          EP
        </span>
        <span
          className="font-display text-[26px] leading-none text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 48, "SOFT" 40, "WONK" 1',
            letterSpacing: "-0.04em",
          }}
        >
          {epNum}
        </span>
      </div>

      {/* Still image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden ring-1 ring-strata-text/10">
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}
        />
        {stillImg && (
          <img
            src={stillImg}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_50%,rgb(0_0_0/0.5)_100%)]" />
        {watched && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-1 bg-strata-bg/85 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-strata-success">
            <span className="h-1 w-1 rounded-full bg-strata-success" />
            Seen
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

      {/* Title + overview + meta */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40 sm:hidden">
            EP {epNum}
          </span>
          <h3
            className="min-w-0 flex-1 font-display text-[20px] leading-tight text-strata-paper sm:truncate sm:text-[22px]"
            style={{
              fontVariationSettings: '"opsz" 36, "SOFT" 50',
              letterSpacing: "-0.025em",
            }}
          >
            {title}
          </h3>
        </div>
        <p className="line-clamp-3 max-w-[640px] text-[13px] leading-[1.55] text-strata-text/65 sm:line-clamp-2">
          {overview}
        </p>
        <div className="mt-1 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">
          {runtime && <span>{runtime}m</span>}
          {!playable && (
            <>
              <Dot />
              <span className="text-strata-warn">Not in library</span>
            </>
          )}
        </div>
      </div>

      {/* Play button */}
      <div className="flex items-center">
        {playable ? (
          <Link
            to={`/watch/${ep.Id}` as never}
            className="group/play inline-flex h-12 w-12 items-center justify-center border border-strata-text/20 text-strata-paper no-underline transition-colors hover:border-strata-accent hover:bg-strata-accent"
            aria-label={`Play episode ${ep.IndexNumber}`}
          >
            <PlayIcon className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="inline-flex h-12 w-12 items-center justify-center border border-strata-text/10 text-strata-text/25">
            <PlayIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  );
};

/* ───────────── Sidebar cards ───────────── */

const SeasonsCard = ({
  seasons,
  episodes,
  activeSeason,
  onSelect,
}: {
  seasons: BaseItemDto[];
  episodes: BaseItemDto[];
  activeSeason: number;
  onSelect: (n: number) => void;
}) => (
  <section>
    <SidebarHeader
      label="Seasons"
      right={
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">
          {seasons.length}
        </span>
      }
    />
    <div className="flex flex-col">
      {seasons.map((season, i) => {
        const total = episodes.filter(
          (e) => e.ParentIndexNumber === season.IndexNumber,
        ).length;
        const watched = episodes.filter(
          (e) =>
            e.ParentIndexNumber === season.IndexNumber && e.UserData?.Played,
        ).length;
        const value = total === 0 ? 0 : watched / total;
        const isActive = season.IndexNumber === activeSeason;
        return (
          <button
            key={season.Id ?? season.IndexNumber}
            onClick={() => onSelect(season.IndexNumber ?? 1)}
            className={cn(
              "group flex flex-col gap-2 border-b rule-thin px-1 py-3 text-left cursor-pointer transition-colors",
              isActive && "bg-strata-paper/[0.03]",
              i === seasons.length - 1 && "border-b-0",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">
                  S{String(season.IndexNumber ?? 1).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "font-display text-[17px] leading-none",
                    isActive ? "text-strata-paper" : "text-strata-text/75 group-hover:text-strata-paper",
                  )}
                  style={{
                    fontVariationSettings: '"opsz" 30, "SOFT" 50',
                    letterSpacing: "-0.02em",
                  }}
                >
                  {season.Name ?? `Season ${season.IndexNumber}`}
                </span>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
                {watched} / {total}
              </span>
            </div>
            <ProgressBar value={value} />
          </button>
        );
      })}
    </div>
  </section>
);

const CriticsCard = ({ score }: { score: number }) => (
  <section>
    <SidebarHeader label="Critics" />
    <div className="flex items-center gap-6 py-2">
      <div className="relative h-20 w-20">
        <svg width="80" height="80" viewBox="0 0 42 42">
          <circle
            cx="21"
            cy="21"
            r="18"
            fill="none"
            stroke="rgb(243 233 211 / 0.12)"
            strokeWidth="2"
          />
          <motion.circle
            cx="21"
            cy="21"
            r="18"
            fill="none"
            stroke="var(--color-strata-accent)"
            strokeWidth="2"
            strokeLinecap="butt"
            transform="rotate(-90 21 21)"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: score / 100 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 1.4, ease: [0.2, 0.6, 0.2, 1] }}
          />
        </svg>
      </div>
      <div>
        <div
          className="font-display text-[40px] leading-none text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 96, "SOFT" 30, "WONK" 1',
            letterSpacing: "-0.04em",
          }}
        >
          <CountUp value={score} />
          <span className="font-mono text-[13px] tracking-normal text-strata-text/45"> / 100</span>
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
          Consensus rating
        </div>
      </div>
    </div>
  </section>
);

const SectionMark = ({
  chapter,
  label,
  sub,
}: {
  chapter: string;
  label: string;
  sub?: string;
}) => (
  <motion.div
    className="flex flex-col gap-4"
    initial="hidden"
    whileInView="show"
    viewport={{ once: true, amount: 0.4 }}
  >
    <div className="flex items-baseline gap-5">
      <motion.span
        variants={{
          hidden: { opacity: 0, x: -6 },
          show: { opacity: 1, x: 0 },
        }}
        transition={{ duration: 0.5, ease: [0.2, 0.6, 0.2, 1] }}
        className="font-mono text-[10px] uppercase tracking-[0.32em] text-strata-text/40"
      >
        Ch. {chapter}
      </motion.span>
      <motion.h2
        variants={{
          hidden: { opacity: 0, y: 8 },
          show: { opacity: 1, y: 0 },
        }}
        transition={{ duration: 0.7, ease: [0.2, 0.6, 0.2, 1], delay: 0.08 }}
        className="font-display font-normal leading-none text-strata-paper"
        style={{
          fontSize: "clamp(28px, 3vw, 44px)",
          fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
          letterSpacing: "-0.035em",
        }}
      >
        {label}
      </motion.h2>
    </div>
    <div className="flex items-center gap-4">
      <motion.div
        variants={{
          hidden: { scaleX: 0 },
          show: { scaleX: 1 },
        }}
        transition={{ duration: 0.9, ease: [0.2, 0.6, 0.2, 1], delay: 0.16 }}
        className="h-px flex-1 origin-left bg-strata-text/15"
      />
      {sub && (
        <motion.span
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1 },
          }}
          transition={{ duration: 0.4, delay: 0.45 }}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45"
        >
          {sub}
        </motion.span>
      )}
    </div>
  </motion.div>
);

/* ───────────── Icons ───────────── */
const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 14 14" fill="currentColor" className={className}>
    <polygon points="3,2 12,7 3,12" />
  </svg>
);
const PlusIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} strokeLinecap="round">
    <path d="M7 2v10M2 7h10" />
  </svg>
);

/* ───────────── States ───────────── */

const NotFound = () => (
  <div className="flex min-h-[calc(100vh-180px)] items-center justify-center px-8">
    <div className="max-w-[480px] text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-text/45">
        Not in the archive
      </div>
      <div className="mx-auto my-4 h-px w-12 bg-strata-accent" />
      <div
        className="font-display text-[48px] leading-[0.95] text-strata-paper"
        style={{
          fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
          letterSpacing: "-0.04em",
        }}
      >
        Show missing.
      </div>
      <p className="mt-4 font-editorial text-[16px] text-strata-text/55">
        We searched the vault and came up empty.
      </p>
      <Link to="/shows" className="btn-glass mt-7 inline-flex">
        Back to shows
      </Link>
    </div>
  </div>
);

const ShowDetailSkeleton = () => (
  <div className="-mt-[112px]">
    <section
      className="relative w-full overflow-hidden"
      style={{ height: "100vh", minHeight: 780 }}
    >
      <div className="absolute inset-0 bg-strata-bg" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] [background:linear-gradient(180deg,transparent_0%,var(--color-strata-bg)_92%)]" />
      <div className="absolute inset-x-0 bottom-0 px-8 pb-32 lg:px-12">
        <div className="flex max-w-[920px] flex-col gap-7">
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-[120px] w-[80%]" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <div className="mt-3 flex gap-3">
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-12 w-28" />
          </div>
        </div>
      </div>
    </section>
    <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-x-12 gap-y-14 px-8 pb-20 pt-16 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-12">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-[640px]" />
        <Skeleton className="h-4 w-5/6 max-w-[600px]" />
        <div className="mt-6 flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-56" />
      </div>
    </div>
  </div>
);
