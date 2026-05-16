import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { listShows, type BaseItemDto } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useHoverAmbient } from "@/strata/ambient";
import { Poster } from "@/strata/Poster";
import { CollectionMasthead } from "./movies";
import { cn, posterUrl } from "@/lib/utils";

type SortKey = "newest" | "title" | "oldest";

const yearOf = (s: BaseItemDto): string | null => {
  if (s.ProductionYear) return String(s.ProductionYear);
  if (s.PremiereDate) return s.PremiereDate.slice(0, 4);
  return null;
};

const dateSortKey = (s: BaseItemDto): string =>
  s.PremiereDate ?? (s.ProductionYear ? `${s.ProductionYear}-01-01` : "");

export const ShowsPage = () => {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;
  return <ShowsInner />;
};

const ShowsInner = () => {
  const shows = useQuery({
    queryKey: ["shows-list"],
    queryFn: listShows,
  });
  const [sort, setSort] = useState<SortKey>("newest");

  const list = (shows.data ?? []).slice();
  if (sort === "title")
    list.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
  else if (sort === "oldest")
    list.sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b)));

  return (
    <div className="anim-fade-in mx-auto max-w-[1680px] px-8 pb-20 pt-10 lg:px-12">
      <CollectionMasthead
        chapter="II"
        title="Series"
        sub="The Catalog of Episodic Programmes"
        count={list.length}
      />

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
          <button
            key={key}
            onClick={() => setSort(key)}
            className={cn(
              "group relative cursor-pointer border-none bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors",
              sort === key
                ? "text-strata-paper"
                : "text-strata-text/55 hover:text-strata-paper",
            )}
          >
            <span
              className={cn(
                "absolute inset-0 inline-flex items-center justify-between transition-opacity",
                sort === key ? "opacity-100" : "opacity-0 group-hover:opacity-60",
              )}
            >
              <span className="text-strata-accent">[</span>
              <span className="text-strata-accent">]</span>
            </span>
            <span className="px-1.5">{label}</span>
          </button>
        ))}
        <div className="flex-1" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/35">
          Showing {list.length}
        </span>
      </div>

      {shows.isLoading ? (
        <div
          className="grid justify-start gap-x-6 gap-y-12"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
        >
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="w-[190px]">
              <div className="skeleton h-[285px] w-[190px]" />
              <div className="skeleton mt-3 h-3 w-3/4" />
              <div className="skeleton mt-1.5 h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="border-y rule-heavy py-20 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-text/45">
            No series yet
          </div>
          <div className="mx-auto my-3 h-px w-10 bg-strata-accent" />
          <div
            className="font-display text-[36px] text-strata-paper"
            style={{
              fontVariationSettings: '"opsz" 144, "SOFT" 30',
              letterSpacing: "-0.03em",
            }}
          >
            Nothing in serial form.
          </div>
          <p className="mx-auto mt-3 max-w-md font-editorial text-[16px] text-strata-text/55">
            Add a TV library in the Jellyfin admin panel to begin filing episodic programmes.
          </p>
        </div>
      ) : (
        <div
          className="grid justify-start gap-x-6 gap-y-12"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
        >
          {list.map((s, idx) => (
            <ShowCard
              key={s.Id!}
              id={s.Id!}
              title={s.Name ?? "Untitled"}
              year={yearOf(s)}
              to={`/shows/${s.Id}`}
              idx={idx + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ShowCard = ({
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
      </Link>
    </motion.div>
  );
};
