import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearch } from "@tanstack/react-router";
import { motion } from "motion/react";
import { search, type BaseItemDto } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { cn, posterUrl } from "@/lib/utils";
import { useHoverAmbient } from "@/strata/ambient";
import { Poster } from "@/strata/Poster";

const FILTER_CHIPS = ["Movies", "Shows", "4K", "HDR", "Subtitled"] as const;
type Filter = (typeof FILTER_CHIPS)[number];

const yearOf = (item: BaseItemDto): string | null => {
  if (item.ProductionYear) return String(item.ProductionYear);
  if (item.PremiereDate) return item.PremiereDate.slice(0, 4);
  return null;
};

export const SearchPage = () => {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;
  return <SearchInner />;
};

const SearchInner = () => {
  const { q: initialQ } = useSearch({ from: "/search" });
  const [q, setQ] = useState(initialQ ?? "");
  const [filters, setFilters] = useState<Filter[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => search(q),
    enabled: q.length >= 2,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const toggle = (f: Filter) =>
    setFilters((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );

  const showMovies = !filters.includes("Shows");
  const showShows = !filters.includes("Movies");
  const movies = showMovies ? results.data?.movies ?? [] : [];
  const shows = showShows ? results.data?.shows ?? [] : [];

  return (
    <div className="anim-fade-in mx-auto max-w-[1680px] px-8 pb-20 pt-10 lg:px-12">
      <header className="mb-10 flex flex-col gap-6">
        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.32em] text-strata-text/45">
          <span>Section</span>
          <span className="h-px flex-1 bg-strata-text/15" />
          <span>Cross-reference</span>
        </div>
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
          Discover.
        </h1>
        <p className="max-w-2xl font-editorial text-[18px] leading-[1.55] text-strata-text/65">
          Search the entire catalog. Type two characters or more. Press{" "}
          <kbd className="rounded-sm border border-strata-text/20 bg-strata-paper/5 px-1 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>{" "}
          from anywhere to summon this page.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-4 border-y rule-heavy bg-strata-paper/[0.02] py-5 px-4">
        <span className="font-display text-[48px] leading-none text-strata-accent">
          /
        </span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="title, cast, mood, director…"
          className="flex-1 border-none bg-transparent font-display text-[28px] text-strata-paper outline-none placeholder:text-strata-text/30"
          style={{
            fontVariationSettings: '"opsz" 60, "SOFT" 50',
            letterSpacing: "-0.02em",
          }}
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/55 hover:text-strata-paper cursor-pointer border-none bg-transparent"
          >
            clear ×
          </button>
        )}
        <span className="ml-2 hidden font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/35 sm:inline">
          {q.length < 2
            ? "Awaiting input"
            : results.isFetching
              ? "Searching…"
              : `${movies.length + shows.length} results`}
        </span>
      </div>

      <div className="mb-12 flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/55">
          Filed under
        </span>
        {FILTER_CHIPS.map((f) => {
          const on = filters.includes(f);
          return (
            <button
              key={f}
              onClick={() => toggle(f)}
              className={cn(
                "group relative cursor-pointer border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors",
                on
                  ? "border-strata-accent bg-strata-accent text-strata-paper"
                  : "border-strata-text/20 text-strata-text/60 hover:border-strata-paper/60 hover:text-strata-paper",
              )}
            >
              {f}
            </button>
          );
        })}
      </div>

      {q.length < 2 && (
        <div className="border-y rule-heavy py-24 text-center">
          <div className="mx-auto h-px w-12 bg-strata-accent" />
          <div
            className="mt-6 font-display text-[40px] leading-none text-strata-paper"
            style={{
              fontVariationSettings: '"opsz" 144, "SOFT" 30',
              letterSpacing: "-0.035em",
            }}
          >
            Awaiting search.
          </div>
          <p className="mx-auto mt-3 max-w-md font-editorial text-[16px] text-strata-text/55">
            Two characters opens the index. Try a title, an actor, a half-remembered scene.
          </p>
        </div>
      )}

      {q.length >= 2 && results.isLoading && (
        <Section title="Searching" count={0}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SearchSkeleton key={i} />
          ))}
        </Section>
      )}

      {movies.length > 0 && (
        <Section title="Movies" count={movies.length}>
          {movies.map((m, idx) => (
            <SearchCard
              key={m.Id!}
              id={m.Id!}
              title={m.Name ?? "Untitled"}
              year={yearOf(m)}
              to={`/movies/${m.Id}`}
              idx={idx + 1}
            />
          ))}
        </Section>
      )}
      {shows.length > 0 && (
        <Section title="Shows" count={shows.length}>
          {shows.map((s, idx) => (
            <SearchCard
              key={s.Id!}
              id={s.Id!}
              title={s.Name ?? "Untitled"}
              year={yearOf(s)}
              to={`/shows/${s.Id}`}
              idx={idx + 1}
            />
          ))}
        </Section>
      )}
      {q.length >= 2 &&
        results.data &&
        movies.length === 0 &&
        shows.length === 0 && (
          <div className="border-y rule-thin py-20 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
              No matches
            </div>
            <div
              className="mt-3 font-display text-[28px] text-strata-paper"
              style={{ fontVariationSettings: '"opsz" 60, "SOFT" 50' }}
            >
              The archive returns empty-handed.
            </div>
            <p className="mt-2 font-editorial text-[15px] text-strata-text/55">
              Try a different term or clear the filters.
            </p>
          </div>
        )}
    </div>
  );
};

const Section = ({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) => (
  <section className="mb-14">
    <div className="mb-6 flex items-baseline gap-4">
      <h2
        className="font-display text-[34px] text-strata-paper"
        style={{
          fontVariationSettings: '"opsz" 80, "SOFT" 40',
          letterSpacing: "-0.03em",
        }}
      >
        {title}
      </h2>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
        · {count} found
      </span>
      <span className="h-px flex-1 bg-strata-text/15" />
    </div>
    <div
      className="grid justify-start gap-x-6 gap-y-10"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}
    >
      {children}
    </div>
  </section>
);

const SearchSkeleton = () => (
  <div className="w-[170px]">
    <div className="skeleton aspect-[2/3] w-full" />
    <div className="skeleton mt-2.5 h-3 w-3/4" />
    <div className="skeleton mt-1.5 h-2.5 w-1/2" />
  </div>
);

const SearchCard = ({
  id,
  title,
  year,
  to,
  idx,
}: {
  id: string;
  title: string;
  year: string | null;
  to: string;
  idx: number;
}) => {
  const ambient = useHoverAmbient(id, posterUrl(id, "w342"));
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
            width={170}
            radius={2}
            showBadges={false}
            showTitle={false}
          />
        </div>
        <div className="mt-2.5 flex items-baseline justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/35">
            № {String(idx).padStart(2, "0")}
          </span>
          {year && (
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/45">
              {year}
            </span>
          )}
        </div>
        <div
          className="mt-1 truncate font-display text-[15px] leading-tight text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 30, "SOFT" 50',
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>
      </Link>
    </motion.div>
  );
};
