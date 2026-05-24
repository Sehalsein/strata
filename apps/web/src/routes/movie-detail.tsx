import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "@tanstack/react-router";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import {
  getItem,
  getSimilarItems,
  ticksToMinutes,
  type BaseItemDto,
} from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { posterUrl, backdropUrl, formatRuntime } from "@/lib/utils";
import { opusFor, paletteFor, volumeFor, type Palette } from "@/strata/theme";
import { CountUp, Skeleton } from "@/strata/primitives";
import { DetailMotif } from "@/strata/Poster";
import { usePageAmbient } from "@/strata/ambient";
import { useImagePalette } from "@/strata/useImagePalette";
import { CreditsRow } from "@/strata/CreditsRow";
import { WatchlistToggle } from "@/strata/WatchlistToggle";
import { SimilarShelf as SimilarShelfRow } from "@/strata/SimilarShelf";

const yearOf = (m: BaseItemDto): string | null => {
  if (m.ProductionYear) return String(m.ProductionYear);
  if (m.PremiereDate) return m.PremiereDate.slice(0, 4);
  return null;
};

export const MovieDetailPage = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;
  return <MovieDetailInner id={id} />;
};

const MovieDetailInner = ({ id }: { id: string }) => {
  const q = useQuery({
    queryKey: ["item", id],
    queryFn: () => getItem(id),
  });
  const similarQ = useQuery({
    queryKey: ["similar", id],
    queryFn: () => getSimilarItems(id, 12),
  });

  const backdropImg = backdropUrl(id) ?? posterUrl(id, "original");
  const imgPalette = useImagePalette(backdropImg);
  const activePalette = imgPalette ?? paletteFor(id);
  usePageAmbient(id, 0.95, imgPalette);

  if (q.isLoading) return <DetailSkeleton />;
  if (!q.data) return <NotFound />;

  const m = q.data;
  const year = yearOf(m);
  const score = m.CommunityRating ? Math.round(m.CommunityRating * 10) : null;
  const runtime = ticksToMinutes(m.RunTimeTicks);
  const similar = (similarQ.data ?? []).slice(0, 8);
  const cast = m.People ?? [];
  const isFav = Boolean(m.UserData?.IsFavorite);

  const audioStreams = (m.MediaSources?.[0]?.MediaStreams ?? []).filter(
    (s) => s.Type === "Audio",
  );
  const subtitleStreams = (m.MediaSources?.[0]?.MediaStreams ?? []).filter(
    (s) => s.Type === "Subtitle",
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="-mt-[112px]"
    >
      <DetailHero
        id={id}
        title={m.Name ?? "Untitled"}
        year={year}
        runtime={runtime}
        genres={m.Genres ?? []}
        tagline={m.Taglines?.[0] ?? null}
        score={score}
        playTo={`/watch/${id}`}
        isFav={isFav}
        palette={activePalette}
        backdropImg={backdropImg}
      />

      <div className="relative z-10 mx-auto grid max-w-[1680px] grid-cols-1 gap-x-12 gap-y-14 px-8 pb-20 pt-16 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-12">
        <article className="flex flex-col gap-14">
          <Synopsis
            tagline={m.Taglines?.[0] ?? null}
            overview={m.Overview ?? null}
            genres={m.Genres ?? []}
          />

          {cast.length > 0 && (
            <section className="flex flex-col gap-7">
              <SectionMark chapter="II" label="Players" sub={`${cast.filter((p) => p.Type === "Actor").length || cast.length} on screen`} />
              <CreditsRow people={cast} />
            </section>
          )}

          {similar.length > 0 && (
            <section className="flex flex-col gap-8">
              <SectionMark
                chapter={cast.length > 0 ? "III" : "II"}
                label="In the Same Spirit"
                sub={`${similar.length} adjacent titles`}
              />
              <SimilarShelfRow items={similar} />
            </section>
          )}
        </article>

        <aside className="flex flex-col gap-10">
          <FileInfoCard
            duration={runtime ? runtime * 60 : null}
            audio={audioStreams}
            subs={subtitleStreams}
            container={m.MediaSources?.[0]?.Container ?? null}
          />
          <CreditsCard
            director={m.People?.find((p) => p.Type === "Director")?.Name ?? null}
            cast={(m.People ?? [])
              .filter((p) => p.Type === "Actor")
              .slice(0, 6)
              .map((p) => p.Name ?? "")}
          />
          <NotesCard />
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
  runtime,
  genres,
  tagline,
  score,
  playTo,
  isFav,
  palette,
  backdropImg,
}: {
  id: string;
  title: string;
  year: string | null;
  runtime: number | null;
  genres: string[];
  tagline: string | null;
  score: number | null;
  playTo: string;
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
      {/* Palette base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, var(--strata-c2) 0%, var(--strata-c1) 100%)",
        }}
      />

      {/* Backdrop with parallax */}
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

      {/* Inky left vignette + bottom dissolve */}
      <div className="absolute inset-0 [background:linear-gradient(95deg,rgb(12_10_8/0.96)_0%,rgb(12_10_8/0.85)_28%,rgb(12_10_8/0.4)_55%,transparent_85%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] [background:linear-gradient(180deg,transparent_0%,var(--strata-c2)_92%)]" />
      <div className="grain-paper absolute inset-0 opacity-[0.6] mix-blend-overlay" />

      {/* Right rail — editorial spec column */}
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
        {score !== null && (
          <>
            <div className="mt-4 h-px w-12 bg-strata-paper/30" />
            <ScoreBadge score={score} />
          </>
        )}
      </motion.div>

      {/* Bottom-left copy */}
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

          {/* Meta spec line */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-strata-paper/70">
            {year && <span>Anno {year}</span>}
            {year && runtime && <Dot />}
            {runtime && <span>{formatRuntime(runtime)}</span>}
            {genres.slice(0, 3).map((g) => (
              <span key={g} className="flex items-center gap-x-4">
                <Dot />
                <span>{g}</span>
              </span>
            ))}
            <Dot />
            <span className="font-editorial normal-case tracking-normal text-[14px] text-strata-paper/85">
              a motion picture
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}>
              <Link to={playTo as never} className="btn-play">
                <PlayIcon className="h-3.5 w-3.5" />
                Begin
              </Link>
            </motion.div>
            <WatchlistToggle itemId={id} initialIsFavorite={isFav} />
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }} className="btn-glass">
              <DotsIcon className="h-3.5 w-3.5" />
              More
            </motion.button>
          </div>
        </motion.div>
      </motion.div>

      {/* Bottom strip */}
      <motion.div
        style={{ opacity: contentOp }}
        className="absolute inset-x-0 bottom-0 z-10"
      >
        <div className="mx-auto flex max-w-[1680px] items-end justify-between gap-6 border-t rule-thin px-8 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/55 lg:px-12">
          <span className="flex items-center gap-3">
            <span className="text-strata-paper/30">Filed Under</span>
            <span className="text-strata-paper/30">/</span>
            <span className="text-strata-paper">Motion Pictures</span>
            <span className="text-strata-paper/30">·</span>
            {genres.slice(0, 2).map((g, i) => (
              <span key={g} className="flex items-center gap-3">
                {i > 0 && <span className="text-strata-paper/30">·</span>}
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
      to="/movies"
      className="group flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-strata-paper/55 no-underline hover:text-strata-paper"
    >
      <span className="transition-transform group-hover:-translate-x-0.5">←</span>
      <span>Movies</span>
    </Link>
    <span className="h-px w-8 bg-strata-paper/25" />
    <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-strata-paper/85">
      Tonight in Repertory
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

const ScoreBadge = ({ score }: { score: number }) => (
  <div className="flex items-center gap-3">
    <div className="text-right">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-paper/55">
        Critics
      </div>
      <div
        className="font-display text-[28px] leading-none text-strata-paper"
        style={{
          fontVariationSettings: '"opsz" 48, "SOFT" 30',
          letterSpacing: "-0.03em",
        }}
      >
        <CountUp value={score} duration={1.2} />
        <span className="font-mono text-[11px] tracking-normal text-strata-paper/45"> / 100</span>
      </div>
    </div>
    <div className="relative h-9 w-9">
      <svg width="36" height="36" viewBox="0 0 28 28">
        <circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke="rgb(243 233 211 / 0.18)"
          strokeWidth="2"
        />
        <motion.circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke="var(--color-strata-accent)"
          strokeWidth="2"
          strokeLinecap="butt"
          transform="rotate(-90 14 14)"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: score / 100 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.2, ease: [0.2, 0.6, 0.2, 1] }}
        />
      </svg>
    </div>
  </div>
);

const Dot = () => <span className="text-strata-paper/25">·</span>;

/* ───────────── Synopsis ───────────── */

const Synopsis = ({
  tagline,
  overview,
  genres,
}: {
  tagline: string | null;
  overview: string | null;
  genres: string[];
}) => (
  <section className="flex flex-col gap-6">
    <SectionMark chapter="I" label="Synopsis" />

    {tagline && (
      <p
        className="font-display italic text-strata-paper"
        style={{
          fontSize: "clamp(28px, 3vw, 44px)",
          lineHeight: "1.15",
          fontVariationSettings: '"opsz" 60, "SOFT" 100',
          letterSpacing: "-0.025em",
          maxWidth: "32ch",
        }}
      >
        “{tagline}”
      </p>
    )}

    {overview ? (
      <div
        className="max-w-[720px] text-[16px] leading-[1.7] text-strata-text/75"
        style={{ fontFeatureSettings: '"ss01"' }}
      >
        {dropCap(overview)}
      </div>
    ) : (
      <p className="font-editorial text-[16px] text-strata-text/45">
        No synopsis on file. The reels speak for themselves.
      </p>
    )}

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

const dropCap = (text: string) => {
  const first = text.charAt(0);
  const rest = text.slice(1);
  return (
    <p>
      <span
        className="float-left mr-2 mt-1 font-display text-strata-paper"
        style={{
          fontSize: "5.5em",
          lineHeight: "0.82",
          fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
          letterSpacing: "-0.04em",
          color: "var(--color-strata-accent)",
        }}
      >
        {first}
      </span>
      {rest}
    </p>
  );
};

/* ───────────── Similar shelf ───────────── */

/* ───────────── Sidebar cards ───────────── */

type Stream = {
  Index?: number | null;
  Language?: string | null;
  DisplayTitle?: string | null;
  Codec?: string | null;
};

export const FileInfoCard = ({
  duration,
  audio,
  subs,
  container,
}: {
  duration: number | null;
  audio: Stream[];
  subs: Stream[];
  container: string | null;
}) => {
  const audioSummary =
    audio.length > 0
      ? audio
          .slice(0, 3)
          .map((a) => `${a.Codec ?? "?"}${a.Language ? ` (${a.Language})` : ""}`)
          .join(" · ")
      : "—";
  const subsSummary =
    subs.length > 0
      ? `${subs.length} tracks${
          subs[0]?.Language
            ? ` · ${subs.slice(0, 3).map((s) => s.Language ?? "?").join(", ")}`
            : ""
        }`
      : "None";
  const rows: Array<[string, string]> = [
    ["Status", "Direct-play"],
    ["Duration", duration ? formatRuntime(Math.round(duration / 60)) : "—"],
    ["Audio", audioSummary],
    ["Subs", subsSummary],
    ["Container", container ?? "—"],
  ];
  return (
    <section>
      <SidebarHeader label="The file" right={<ReadyBadge />} />
      <dl className="flex flex-col">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex gap-4 border-b rule-thin py-3 last:border-b-0"
          >
            <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
              {k}
            </dt>
            <dd className="flex-1 break-words font-mono text-[12px] text-strata-paper">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

const ReadyBadge = () => (
  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-success">
    <span className="anim-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-strata-success" />
    Ready
  </span>
);

const CreditsCard = ({
  director,
  cast,
}: {
  director: string | null;
  cast: string[];
}) => {
  if (!director && cast.length === 0) return null;
  return (
    <section>
      <SidebarHeader label="The credits" />
      <div className="flex flex-col">
        {director && (
          <div className="flex gap-4 border-b rule-thin py-3">
            <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
              Directed
            </span>
            <span
              className="flex-1 font-display text-[18px] italic text-strata-paper"
              style={{
                fontVariationSettings: '"opsz" 36, "SOFT" 90',
              }}
            >
              {director}
            </span>
          </div>
        )}
        {cast.length > 0 && (
          <div className="flex gap-4 py-3">
            <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
              With
            </span>
            <div className="flex-1 leading-relaxed text-[14px] text-strata-paper/85">
              {cast.map((c, i) => (
                <span key={c}>
                  <span
                    className="font-display"
                    style={{
                      fontVariationSettings: '"opsz" 24, "SOFT" 60',
                    }}
                  >
                    {c}
                  </span>
                  {i < cast.length - 1 && (
                    <span className="font-mono text-strata-text/30"> · </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const NotesCard = () => (
  <section>
    <SidebarHeader label="Marginalia" right={<span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">0</span>} />
    <div className="border border-dashed border-strata-text/15 p-5">
      <div
        className="font-display italic text-[18px] text-strata-paper"
        style={{ fontVariationSettings: '"opsz" 24, "SOFT" 90' }}
      >
        A blank page awaits.
      </div>
      <p className="mt-2 font-editorial text-[13px] text-strata-text/55">
        Leave a household note — watch order, recommendations, a half-remembered scene.
      </p>
    </div>
  </section>
);

export const SidebarHeader = ({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) => (
  <div className="mb-3 flex items-baseline gap-3 border-b rule-heavy pb-2">
    <h3
      className="font-display text-[20px] text-strata-paper"
      style={{
        fontVariationSettings: '"opsz" 36, "SOFT" 40',
        letterSpacing: "-0.025em",
      }}
    >
      {label}
    </h3>
    <div className="flex-1" />
    {right}
  </div>
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
const DotsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 14 14" fill="currentColor" className={className}>
    <circle cx="3" cy="7" r="1.4" />
    <circle cx="7" cy="7" r="1.4" />
    <circle cx="11" cy="7" r="1.4" />
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
        Reel missing.
      </div>
      <p className="mt-4 font-editorial text-[16px] text-strata-text/55">
        We searched the vault and came up empty.
      </p>
      <Link to="/movies" className="btn-glass mt-7 inline-flex">
        Back to movies
      </Link>
    </div>
  </div>
);

const DetailSkeleton = () => (
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
            <Skeleton className="h-12 w-28" />
            <Skeleton className="h-12 w-28" />
          </div>
        </div>
      </div>
    </section>
    <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-x-12 gap-y-14 px-8 pb-20 pt-16 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-12">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-full max-w-[640px]" />
        <Skeleton className="h-4 w-5/6 max-w-[600px]" />
        <Skeleton className="h-4 w-4/6 max-w-[520px]" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-44" />
        <Skeleton className="h-32" />
      </div>
    </div>
  </div>
);
