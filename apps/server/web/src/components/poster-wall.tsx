import { cn } from "@/lib/utils";

/*
 * A wall of made-up posters drifting upward: the backdrop of the sign-in and onboarding
 * screens. Abstract on purpose (gradients and shapes in Strata's colours), so it never
 * shows anyone's artwork. Decorative only; still for reduced motion.
 */

const SKIES = [
  ["#f2b544", "#c2502f"],
  ["#1b2a4a", "#f08a48"],
  ["#3b1d3a", "#d2603f"],
  ["#0f3b3a", "#f7c873"],
  ["#2a1a12", "#f39256"],
  ["#22304f", "#7db7ff"],
  ["#4a1f1a", "#f2b544"],
  ["#1d2025", "#b9a4ff"],
  ["#5a2a14", "#f7c873"],
  ["#13242b", "#4cd08a"],
] as const;

type Shape = "sun" | "bands" | "peak" | "ring";
const SHAPES: Shape[] = ["sun", "bands", "peak", "ring"];

export function Poster({ seed }: { seed: number }) {
  const [from, to] = SKIES[seed % SKIES.length]!;
  const shape = SHAPES[(seed * 7) % SHAPES.length]!;
  const angle = 150 + ((seed * 37) % 60);
  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10" style={{ background: `linear-gradient(${angle}deg, ${from}, ${to})` }}>
      {shape === "sun" && <div className="absolute top-[18%] left-1/2 size-[46%] -translate-x-1/2 rounded-full bg-white/25 blur-[1px]" />}
      {shape === "ring" && <div className="absolute top-[16%] left-1/2 size-[56%] -translate-x-1/2 rounded-full border-[6px] border-white/20" />}
      {shape === "bands" && (
        <div className="absolute inset-x-0 top-[22%] flex flex-col gap-2 px-[14%]">
          <div className="h-3 rounded-full bg-white/25" />
          <div className="h-3 w-3/4 rounded-full bg-white/15" />
          <div className="h-3 w-1/2 rounded-full bg-white/10" />
        </div>
      )}
      {shape === "peak" && <div className="absolute inset-x-0 bottom-[30%] h-[40%] bg-black/20 [clip-path:polygon(0_100%,35%_20%,55%_60%,75%_0,100%_100%)]" />}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="absolute inset-x-[12%] bottom-[9%] flex flex-col gap-1.5">
        <div className="h-2 w-4/5 rounded-full bg-white/70" />
        <div className="h-1.5 w-2/5 rounded-full bg-white/35" />
      </div>
    </div>
  );
}

/** Columns of posters, each drifting at its own pace; fills its parent (position it yourself). */
export function PosterWall({ columns = 4, className }: { columns?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none flex gap-4 overflow-hidden select-none", className)}>
      {Array.from({ length: columns }, (_, c) => {
        const posters = Array.from({ length: 6 }, (_, i) => c * 6 + i + 1);
        return (
          <div key={c} className={cn("flex min-w-0 flex-1 flex-col", c % 2 === 1 && "-mt-24")}>
            {/* Two copies, moved up by one: the loop has no seam. */}
            <div className="animate-poster-drift flex flex-col gap-4" style={{ ["--drift" as string]: `${70 + c * 18}s` }}>
              {[...posters, ...posters].map((seed, i) => (
                <Poster key={i} seed={seed} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
