import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { posterUrl } from "@/lib/utils";
import { Poster } from "@/strata/Poster";
import { useHoverAmbient } from "@/strata/ambient";
import type { BaseItemDto } from "@/lib/api";

const yearOf = (s: BaseItemDto): string | null => {
  if (s.ProductionYear) return String(s.ProductionYear);
  if (s.PremiereDate) return s.PremiereDate.slice(0, 4);
  return null;
};

export const SimilarShelf = ({ items }: { items: BaseItemDto[] }) => (
  <div
    className="row-mask no-scrollbar -mx-3 flex gap-6 overflow-x-auto px-3 pb-3"
    style={{ scrollSnapType: "x proximity" }}
  >
    {items.map((s, idx) => (
      <SimilarItem
        key={s.Id!}
        id={s.Id!}
        title={s.Name ?? "Untitled"}
        year={yearOf(s)}
        to={s.Type === "Series" ? `/shows/${s.Id}` : `/movies/${s.Id}`}
        idx={idx + 1}
      />
    ))}
  </div>
);

const SimilarItem = ({
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
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      onPointerEnter={ambient.onPointerEnter}
      onPointerLeave={ambient.onPointerLeave}
      style={{ scrollSnapAlign: "start" }}
    >
      <Link to={to as never} className="block w-[170px] shrink-0 no-underline">
        <Poster
          id={id}
          title={title}
          year={year}
          imageUrl={posterUrl(id, "w342")}
          width={170}
          radius={2}
          showBadges={false}
          showTitle={false}
        />
        <div className="mt-3 flex items-baseline justify-between gap-2">
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
