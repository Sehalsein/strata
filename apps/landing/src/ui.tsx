import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./sections";

/**
 * The Strata mark in tinted glass, like the app icon: its sand, orange and rust bands,
 * each brighter at the top, with a white sheen and a bright rim. The one place the orange
 * stays; the rest of the page is neutral.
 */
export function GlassMark({ size = 28, className }: { size?: number; className?: string }) {
  const bands = [
    { d: "M0 0 L252 137 L0 137 Z", from: "#fbdc9c", to: "#f2b544" },
    { d: "M0 181 L333 181 L460 250 L333 319 L0 319 Z", from: "#f8b083", to: "#e8743a" },
    { d: "M0 363 L252 363 L0 500 Z", from: "#e98a6b", to: "#b8492b" },
  ];
  return (
    <svg viewBox="-12 -12 484 524" width={size * 0.92} height={size} className={cn("shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]", className)} aria-hidden="true">
      <defs>
        {bands.map((b, i) => (
          <linearGradient key={i} id={`mark-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={b.from} />
            <stop offset="1" stopColor={b.to} />
          </linearGradient>
        ))}
        <linearGradient id="mark-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="mark-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {bands.map((b, i) => (
        <g key={i} strokeLinejoin="round">
          <path d={b.d} fill={`url(#mark-${i})`} stroke={`url(#mark-${i})`} strokeWidth="16" />
          <path d={b.d} fill="url(#mark-sheen)" />
          <path d={b.d} fill="none" stroke="url(#mark-rim)" strokeWidth="5" />
        </g>
      ))}
    </svg>
  );
}

/** A link in the apps' button styles: solid white (the one main action) or glass. */
export function GlassLink({ href, children, solid, size = "md", className }: { href: string; children: ReactNode; solid?: boolean; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-all duration-200 hover:scale-[1.03] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none [&_svg]:size-[1.05em]",
        solid ? "glass-solid" : "glass text-white hover:bg-white/15",
        size === "sm" && "h-9 px-4 text-sm",
        size === "md" && "h-11 px-5 text-sm",
        size === "lg" && "h-13 px-7 text-base",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** A section's heading: a quiet eyebrow, the title, and a line under it. */
export function Heading({ eyebrow, title, lede, center }: { eyebrow: string; title: string; lede?: string; center?: boolean }) {
  return (
    <Reveal className={cn("mb-14 max-w-2xl", center && "mx-auto text-center")}>
      <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-white/45 uppercase">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-5xl">{title}</h2>
      {lede && <p className="mt-4 text-lg text-pretty text-white/60">{lede}</p>}
    </Reveal>
  );
}

/** Soft colour behind a part of the page, for the glass in front of it to pick up. */
export function Glow({ className, color = "rgba(120,140,255,0.22)" }: { className?: string; color?: string }) {
  return <div aria-hidden="true" className={cn("animate-drift pointer-events-none absolute rounded-full blur-3xl", className)} style={{ background: `radial-gradient(closest-side, ${color}, transparent)` }} />;
}
