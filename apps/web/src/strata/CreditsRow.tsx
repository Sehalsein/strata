import { motion } from "motion/react";
import { posterUrl } from "@/lib/utils";
import type { BaseItemDto } from "@/lib/api";

type Person = NonNullable<BaseItemDto["People"]>[number];

export const CreditsRow = ({ people }: { people: Person[] }) => {
  const actors = people.filter((p) => p.Type === "Actor");
  const cast = actors.length > 0 ? actors : people;
  if (cast.length === 0) return null;
  return (
    <div
      className="row-mask no-scrollbar -mx-3 flex gap-7 overflow-x-auto px-3 pb-3"
      style={{ scrollSnapType: "x proximity" }}
    >
      {cast.slice(0, 16).map((p) => (
        <CastChip key={(p.Id ?? "") + (p.Name ?? "")} person={p} />
      ))}
    </div>
  );
};

const CastChip = ({ person }: { person: Person }) => {
  const img = person.Id ? posterUrl(person.Id, "w185", person.PrimaryImageTag) : null;
  const initials = (person.Name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="flex w-[112px] shrink-0 flex-col gap-2.5"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="relative aspect-square w-[112px] overflow-hidden rounded-full ring-1 ring-strata-text/15">
        {img ? (
          <img
            src={img}
            alt={person.Name ?? ""}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-strata-paper/[0.04]">
            <span
              className="font-display text-[26px] text-strata-paper/55"
              style={{ fontVariationSettings: '"opsz" 36, "SOFT" 60' }}
            >
              {initials || "·"}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <div
          className="line-clamp-2 font-display text-[13px] leading-tight text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 24, "SOFT" 60',
            letterSpacing: "-0.015em",
          }}
        >
          {person.Name ?? "—"}
        </div>
        {person.Role && (
          <div className="line-clamp-2 font-editorial text-[11px] italic text-strata-text/55">
            {person.Role}
          </div>
        )}
      </div>
    </motion.div>
  );
};
