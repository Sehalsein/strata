import { useState, type CSSProperties, type ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  hexA,
  motifFor,
  paletteFor,
  type MotifKey,
  type Palette,
  type Theme,
  aurora,
} from "./theme";
import { useHoverAmbient } from "./ambient";
import { cn } from "@/lib/utils";

const POSTER_MOTIFS: Record<MotifKey, (p: Palette) => ReactElement> = {
  "sun-horizon": (p) => (
    <>
      <defs>
        <radialGradient id="m-sun" cx="0.5" cy="0.45" r="0.4">
          <stop offset="0%" stopColor={p[2]} stopOpacity="1" />
          <stop offset="60%" stopColor={p[0]} stopOpacity="0.6" />
          <stop offset="100%" stopColor={p[1]} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="68" r="28" fill="url(#m-sun)" />
      <circle cx="50" cy="68" r="22" fill={p[2]} opacity="0.85" />
      <path d="M0 95 Q 25 86, 50 92 T 100 88 L 100 150 L 0 150 Z" fill={p[1]} opacity="0.55" />
      <path d="M0 108 Q 30 100, 60 106 T 100 102 L 100 150 L 0 150 Z" fill={p[1]} opacity="0.85" />
    </>
  ),
  corridor: (p) => (
    <>
      <polygon points="0,150 100,150 65,75 35,75" fill={p[1]} opacity="0.18" />
      <polygon points="0,0 100,0 65,75 35,75" fill={p[1]} opacity="0.10" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={47 - (10 - i * 2)}
          y={15 + i * 10}
          width={6 + (10 - i * 2) * 2}
          height="1.4"
          fill={p[1]}
          opacity={0.6 - i * 0.08}
        />
      ))}
      <rect x="46" y="68" width="8" height="12" fill={p[2]} opacity="0.55" />
      <rect x="48" y="82" width="4" height="14" fill={p[0]} opacity="0.9" />
      <circle cx="50" cy="80" r="2.2" fill={p[0]} opacity="0.9" />
    </>
  ),
  atom: (p) => (
    <>
      <ellipse cx="50" cy="62" rx="38" ry="14" fill="none" stroke={p[1]} strokeWidth="0.5" opacity="0.7" transform="rotate(25 50 62)" />
      <ellipse cx="50" cy="62" rx="38" ry="14" fill="none" stroke={p[1]} strokeWidth="0.5" opacity="0.6" transform="rotate(-25 50 62)" />
      <ellipse cx="50" cy="62" rx="38" ry="14" fill="none" stroke={p[1]} strokeWidth="0.5" opacity="0.5" transform="rotate(85 50 62)" />
      <circle cx="50" cy="62" r="7" fill={p[1]} opacity="0.92" />
      <circle cx="50" cy="62" r="3" fill={p[2]} />
    </>
  ),
  "rising-sun": (p) => (
    <>
      <circle cx="50" cy="50" r="30" fill={p[1]} opacity="0.85" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path
          key={i}
          d={`M 50 50 L ${50 + 65 * Math.cos((i - 3.5) * 0.35)} ${50 + 65 * Math.sin((i - 3.5) * 0.35)} L ${50 + 70 * Math.cos((i - 3.0) * 0.35)} ${50 + 70 * Math.sin((i - 3.0) * 0.35)} Z`}
          fill={p[1]}
          opacity="0.25"
        />
      ))}
      <rect x="0" y="100" width="100" height="50" fill={p[1]} opacity="0.35" />
    </>
  ),
  bands: (p) => (
    <>
      {[20, 40, 60, 80, 100].map((y, i) => (
        <rect key={i} x="0" y={y} width="100" height="8" fill={p[1]} opacity={0.18 + (i % 2) * 0.18} />
      ))}
      <circle cx="50" cy="55" r="14" fill={p[1]} opacity="0.85" />
      <circle cx="50" cy="55" r="9" fill={p[2]} opacity="0.7" />
    </>
  ),
  split: (p) => (
    <>
      <polygon points="0,0 50,0 50,150 0,150" fill={p[1]} opacity="0.7" />
      <polygon points="50,0 100,0 100,150 50,150" fill={p[0]} opacity="0.35" />
      <line x1="50" y1="0" x2="50" y2="150" stroke={p[2]} strokeWidth="0.6" opacity="0.95" />
      <circle cx="32" cy="60" r="12" fill={p[2]} opacity="0.55" />
      <circle cx="68" cy="60" r="12" fill={p[2]} opacity="0.55" />
    </>
  ),
  neon: (p) => (
    <>
      <rect x="6" y="12" width="88" height="100" fill="none" stroke={p[0]} strokeWidth="0.8" opacity="0.85" rx="3" />
      <rect x="10" y="16" width="80" height="92" fill="none" stroke={p[0]} strokeWidth="0.3" opacity="0.6" rx="2" />
      <path d="M 25 70 Q 50 30, 75 70" fill="none" stroke={p[0]} strokeWidth="1.5" opacity="0.9" />
      <path d="M 25 70 Q 50 30, 75 70" fill="none" stroke={p[2]} strokeWidth="0.3" opacity="0.95" />
    </>
  ),
  "twin-arc": (p) => (
    <>
      <path d="M 5 130 Q 50 20, 95 130" fill="none" stroke={p[1]} strokeWidth="0.6" opacity="0.8" />
      <path d="M 5 135 Q 50 30, 95 135" fill="none" stroke={p[1]} strokeWidth="0.4" opacity="0.55" />
      <circle cx="35" cy="68" r="3.5" fill={p[1]} opacity="0.95" />
      <circle cx="65" cy="68" r="3.5" fill={p[1]} opacity="0.95" />
    </>
  ),
  archway: (p) => (
    <>
      <rect x="20" y="40" width="60" height="80" fill={p[1]} opacity="0.65" />
      <path d="M 25 95 Q 25 55, 50 55 Q 75 55, 75 95 L 75 120 L 25 120 Z" fill={p[0]} opacity="0.85" />
      <line x1="50" y1="55" x2="50" y2="120" stroke={p[2]} strokeWidth="0.4" opacity="0.4" />
    </>
  ),
  rings: (p) => (
    <>
      <circle cx="50" cy="65" r="34" fill="none" stroke={p[1]} strokeWidth="0.4" opacity="0.55" />
      <circle cx="50" cy="65" r="26" fill="none" stroke={p[1]} strokeWidth="0.4" opacity="0.65" />
      <circle cx="50" cy="65" r="18" fill="none" stroke={p[1]} strokeWidth="0.4" opacity="0.75" />
      <circle cx="50" cy="65" r="10" fill={p[1]} opacity="0.92" />
      <circle cx="50" cy="65" r="4" fill={p[2]} />
    </>
  ),
  aurora: (p) => (
    <>
      <path d="M 0 50 Q 30 30, 50 50 T 100 45 L 100 80 L 0 85 Z" fill={p[1]} opacity="0.35" />
      <path d="M 0 55 Q 30 38, 50 58 T 100 52 L 100 75 L 0 80 Z" fill={p[1]} opacity="0.5" />
      <rect x="0" y="100" width="100" height="50" fill={p[2]} opacity="0.7" />
      <line x1="0" y1="100" x2="100" y2="100" stroke={p[1]} strokeWidth="0.4" opacity="0.6" />
    </>
  ),
  court: (p) => (
    <>
      <rect x="15" y="20" width="70" height="110" fill={p[1]} opacity="0.18" />
      <rect x="15" y="20" width="70" height="110" fill="none" stroke={p[2]} strokeWidth="0.5" opacity="0.9" />
      <line x1="50" y1="20" x2="50" y2="130" stroke={p[2]} strokeWidth="0.5" opacity="0.9" />
      <line x1="15" y1="75" x2="85" y2="75" stroke={p[2]} strokeWidth="0.5" opacity="0.9" />
      <circle cx="62" cy="60" r="3" fill={p[2]} />
    </>
  ),
  eye: (p) => (
    <>
      <ellipse cx="50" cy="65" rx="40" ry="22" fill="none" stroke={p[1]} strokeWidth="0.6" opacity="0.7" />
      <ellipse cx="50" cy="65" rx="36" ry="18" fill={p[1]} opacity="0.5" />
      <circle cx="50" cy="65" r="14" fill={p[2]} />
      <circle cx="50" cy="65" r="6" fill={p[1]} />
      <circle cx="52" cy="63" r="2" fill={p[2]} />
    </>
  ),
  "moon-prairie": (p) => (
    <>
      <circle cx="65" cy="48" r="18" fill={p[1]} opacity="0.92" />
      <circle cx="68" cy="44" r="1.5" fill={p[0]} opacity="0.4" />
      <circle cx="60" cy="52" r="1" fill={p[0]} opacity="0.4" />
      <path d="M 0 95 Q 25 90, 50 92 T 100 90 L 100 150 L 0 150 Z" fill={p[1]} opacity="0.30" />
      <path d="M 0 110 Q 30 105, 60 108 T 100 105 L 100 150 L 0 150 Z" fill={p[2]} opacity="0.20" />
    </>
  ),
  "flag-torn": (p) => (
    <>
      {[35, 52, 69, 86].map((y, i) => (
        <path
          key={i}
          d={`M 0 ${y} L ${30 + i * 5} ${y + 1} L ${50 - i * 3} ${y - 2} L 100 ${y + 1}`}
          stroke={p[2]}
          strokeWidth="3"
          fill="none"
          opacity={0.7 - i * 0.1}
        />
      ))}
      <rect x="0" y="10" width="40" height="22" fill={p[1]} opacity="0.85" />
      {[14, 18, 22, 26].map((y, i) => (
        <circle key={i} cx={5 + (i % 2) * 5} cy={y} r="1.2" fill={p[2]} opacity="0.9" />
      ))}
    </>
  ),
  vault: (p) => (
    <>
      <circle cx="50" cy="55" r="28" fill="none" stroke={p[1]} strokeWidth="0.6" opacity="0.55" />
      <text x="50" y="63" textAnchor="middle" fontSize="36" fontWeight="900" fill={p[1]} opacity="0.92" fontFamily="Inter, sans-serif">76</text>
      <line x1="20" y1="115" x2="80" y2="115" stroke={p[2]} strokeWidth="0.6" opacity="0.7" />
    </>
  ),
  pod: (p) => (
    <>
      <ellipse cx="50" cy="55" rx="36" ry="14" fill={p[1]} opacity="0.85" />
      <ellipse cx="50" cy="55" rx="36" ry="14" fill="none" stroke={p[2]} strokeWidth="0.3" opacity="0.7" />
      <ellipse cx="50" cy="55" rx="30" ry="11" fill={p[2]} opacity="0.15" />
      <line x1="0" y1="85" x2="100" y2="85" stroke={p[1]} strokeWidth="0.3" opacity="0.5" />
    </>
  ),
  megacity: (p) => (
    <>
      <circle cx="70" cy="42" r="14" fill={p[0]} opacity="0.85" />
      {[
        [8, 90, 8, 55],
        [20, 90, 4, 40],
        [26, 90, 10, 60],
        [40, 90, 5, 30],
        [48, 90, 8, 68],
        [58, 90, 4, 42],
        [66, 90, 12, 50],
        [80, 90, 5, 72],
        [88, 90, 8, 45],
        [96, 90, 4, 38],
      ].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y - h} width={w} height={h} fill={p[1]} opacity={0.75 + (i % 2) * 0.1} />
      ))}
      {[8, 20, 26, 40, 48, 58, 66, 80, 88].map((x, i) => (
        <rect key={i} x={x + 1} y={50 + (i % 4) * 5} width="1" height="1" fill={p[2]} opacity="0.95" />
      ))}
    </>
  ),
};

type PosterProps = {
  id: string;
  title: string;
  year?: string | null;
  imageUrl?: string | null;
  to?: string;
  width?: number;
  aspect?: "portrait" | "landscape";
  radius?: number;
  active?: boolean;
  progress?: number;
  showTitle?: boolean;
  showBadges?: boolean;
  quality4k?: boolean;
  onHover?: () => void;
  onClick?: () => void;
  className?: string;
  /** If set, hovering swaps the page ambient palette to this title's. */
  ambientId?: string;
};

export const Poster = ({
  id,
  title,
  year,
  imageUrl,
  to,
  width = 200,
  aspect = "portrait",
  radius = 6,
  active = false,
  progress,
  showTitle = true,
  showBadges = true,
  quality4k = false,
  onHover,
  onClick,
  className,
  ambientId,
}: PosterProps) => {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgErrored, setImgErrored] = useState(false);
  const ambient = useHoverAmbient(ambientId ?? null);
  const h = aspect === "landscape" ? Math.round((width * 9) / 16) : Math.round((width * 3) / 2);
  const palette = paletteFor(id);
  const [c1, c2, c3] = palette;
  const motif = motifFor(id);
  const motifFn = POSTER_MOTIFS[motif];
  const imgUrl = imageUrl ?? null;

  const cssVars = {
    "--c1": c1,
    "--c2": c2,
    "--c3": c3,
    "--w": `${width}px`,
    "--h": `${h}px`,
    "--r": `${radius}px`,
  } as CSSProperties;

  const content = (
    <div
      onMouseEnter={() => {
        onHover?.();
        if (ambientId) ambient.onPointerEnter();
      }}
      onMouseLeave={() => {
        if (ambientId) ambient.onPointerLeave();
      }}
      className={cn(
        "relative shrink-0 overflow-hidden transition-[transform,box-shadow] duration-200",
        active && "-translate-y-0.5",
        onClick || to ? "cursor-pointer" : "",
        className,
      )}
      style={{
        ...cssVars,
        width,
        height: h,
        borderRadius: radius,
        background: `linear-gradient(155deg, ${c1} 0%, ${c2} 100%)`,
        boxShadow: active
          ? `0 0 0 2px ${aurora.accent}, 0 16px 40px rgb(0 0 0 / 0.55), 0 12px 32px rgb(232 51 31 / 0.35)`
          : "0 8px 28px rgb(0 0 0 / 0.45), inset 0 0 0 1px rgb(255 255 255 / 0.06)",
      }}
    >
      <svg
        viewBox={`0 0 100 ${aspect === "landscape" ? Math.round((100 * 9) / 16) : 150}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        {motifFn(palette)}
      </svg>

      {imgUrl && !imgErrored && (
        <img
          src={imgUrl}
          alt={title}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgErrored(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            imgLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgb(0_0_0/0.42)_78%,rgb(0_0_0/0.78)_100%)]" />

      {showTitle && (!imgUrl || imgErrored || !imgLoaded) && (
        <div
          className={cn(
            "absolute font-display leading-[0.95] [text-shadow:0_2px_12px_rgb(0_0_0/0.55)]",
            aspect === "landscape" ? "left-4 right-4 bottom-3" : "left-3 right-3 bottom-2.5",
          )}
          style={{
            color: c3,
            fontSize: Math.max(13, Math.round(width * 0.11)),
            fontVariationSettings: '"opsz" 96, "SOFT" 40, "WONK" 1',
            letterSpacing: "-0.035em",
          }}
        >
          {title.split(/[:·]/)[0].trim()}
        </div>
      )}

      {showBadges && year && (
        <div
          className="absolute right-2.5 top-2.5 font-mono tracking-wide text-white [text-shadow:0_1px_4px_rgb(0_0_0/0.6)] opacity-75"
          style={{ fontSize: Math.max(8, width * 0.04) }}
        >
          {year}
        </div>
      )}

      {showBadges && quality4k && (
        <div
          className="absolute left-2.5 top-2.5 rounded-[3px] bg-black/40 px-1.5 py-0.5 font-bold uppercase tracking-wide text-white backdrop-blur-sm"
          style={{ fontSize: Math.max(7, width * 0.035) }}
        >
          4K · HDR
        </div>
      )}

      {typeof progress === "number" && progress > 0 && progress < 1 && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50">
          <div
            className="h-full bg-strata-accent"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      <div className="noise-overlay-soft absolute inset-0 opacity-45" />
    </div>
  );

  if (to)
    return (
      <Link to={to as never} onClick={onClick} className="block shrink-0 no-underline">
        {content}
      </Link>
    );
  if (onClick)
    return (
      <div onClick={onClick} className="shrink-0">
        {content}
      </div>
    );
  return content;
};

type PosterCardProps = PosterProps & { subtitle?: string };

export const PosterCard = ({ subtitle, ...rest }: PosterCardProps) => {
  const width = rest.width ?? 148;
  const ambient = useHoverAmbient(rest.ambientId ?? null);
  return (
    <motion.div
      onMouseEnter={() => {
        rest.onHover?.();
        if (rest.ambientId) ambient.onPointerEnter();
      }}
      onMouseLeave={() => {
        if (rest.ambientId) ambient.onPointerLeave();
      }}
      onClick={rest.onClick}
      whileHover={{ y: -4, scale: 1.025 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={cn(
        "flex shrink-0 flex-col gap-2",
        rest.onClick || rest.to ? "cursor-pointer" : "",
      )}
      style={{ width, scrollSnapAlign: "start" }}
    >
      <Poster {...rest} width={width} radius={rest.radius ?? 2} />
      <div>
        <div
          className="truncate font-display text-[15px] leading-tight text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 30, "SOFT" 50',
            letterSpacing: "-0.02em",
          }}
        >
          {rest.title}
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.22em] text-strata-text/40">
            {subtitle}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const TitleBackdrop = ({
  paletteKey,
  theme: t = aurora,
}: {
  paletteKey: string | null;
  theme?: Theme;
}) => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    {/* Flat uniform darkening so this layer doesn't introduce a vertical
     * brightness band as the user scrolls. */}
    <div
      className="absolute inset-0"
      style={{ background: hexA(t.bg, 0.55) }}
    />
    <div className="noise-overlay absolute inset-0 opacity-40" />

    {/* Cross-fade the per-title art layer so SVG stop colors swap without flash */}
    <AnimatePresence mode="sync">
      {paletteKey && (
        <motion.div
          key={paletteKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="absolute inset-0"
        >
          <BackdropArt paletteKey={paletteKey} />
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

const BackdropArt = ({ paletteKey }: { paletteKey: string }) => {
  const palette = paletteFor(paletteKey);
  const [c1, c2] = palette;
  const motif = motifFor(paletteKey);
  const motifFn = POSTER_MOTIFS[motif];
  const safeId = paletteKey.replace(/[^a-z0-9]/gi, "");
  return (
    <>
      <div className="absolute -top-[20%] -right-[20%] h-[120%] w-[90%] origin-top-right scale-110 opacity-55 [filter:blur(80px)_saturate(140%)]">
        <svg
          viewBox="0 0 100 150"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full"
        >
          <defs>
            <linearGradient id={`bd1-${safeId}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={c1} />
              <stop offset="100%" stopColor={c2} />
            </linearGradient>
          </defs>
          <rect width="100" height="150" fill={`url(#bd1-${safeId})`} />
          {motifFn(palette)}
        </svg>
      </div>
      <div
        className="absolute -bottom-[30%] -left-[20%] h-full w-[70%] opacity-45 [filter:blur(60px)]"
        style={{
          background: `radial-gradient(50% 50% at 50% 50%, ${c2} 0%, transparent 70%)`,
        }}
      />
    </>
  );
};

export const HeroMotif = ({ paletteKey }: { paletteKey: string }) => {
  const palette = paletteFor(paletteKey);
  const motif = motifFor(paletteKey);
  const motifFn = POSTER_MOTIFS[motif];
  const gid = `hero-sun-${paletteKey.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg
      viewBox="0 0 160 56"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
    >
      <defs>
        <radialGradient id={gid} cx="0.72" cy="0.32" r="0.45">
          <stop offset="0%" stopColor={palette[2]} stopOpacity="1" />
          <stop offset="55%" stopColor={palette[0]} stopOpacity="0.45" />
          <stop offset="100%" stopColor={palette[1]} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="160" height="56" fill={`url(#${gid})`} />
      <g transform="translate(50, -20) scale(1.4 1.0)">{motifFn(palette)}</g>
    </svg>
  );
};

export const HeroOrb = ({ paletteKey }: { paletteKey: string }) => {
  const palette = paletteFor(paletteKey);
  const motif = motifFor(paletteKey);
  const MotifFn = POSTER_MOTIFS[motif];
  const [c1, c2, c3] = palette;
  return (
    <div className="pointer-events-none relative h-full w-full">
      {/* Outer glow */}
      <div
        className="absolute inset-[-15%] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle at 40% 40%, ${c1}aa, transparent 60%)`,
          opacity: 0.85,
        }}
      />
      {/* Inner orb */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 32% 28%, ${c3} 0%, ${c1} 38%, ${c2} 82%, ${c2}cc 100%)`,
          boxShadow: `0 0 200px ${c1}66, inset 0 0 80px rgb(0 0 0 / 0.35)`,
        }}
      />
      {/* Motif overlay — subtle */}
      <svg
        viewBox="0 0 100 150"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full rounded-full opacity-25 mix-blend-screen"
      >
        {MotifFn(palette)}
      </svg>
      {/* Highlight */}
      <div
        className="absolute inset-[15%] rounded-full blur-2xl"
        style={{
          background: `radial-gradient(circle at 30% 25%, ${c3}55, transparent 50%)`,
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
};

export const DetailMotif = ({ paletteKey }: { paletteKey: string }) => {
  const palette = paletteFor(paletteKey);
  const motif = motifFor(paletteKey);
  const motifFn = POSTER_MOTIFS[motif];
  const gid = `hbg-${paletteKey.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg
      viewBox="0 0 100 56"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
    >
      <defs>
        <radialGradient id={gid} cx="0.7" cy="0.35" r="0.55">
          <stop offset="0%" stopColor={palette[2]} stopOpacity="0.85" />
          <stop offset="55%" stopColor={palette[0]} stopOpacity="0.4" />
          <stop offset="100%" stopColor={palette[1]} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="56" fill={`url(#${gid})`} />
      <g transform="translate(40, -30) scale(1.6 0.75)">{motifFn(palette)}</g>
    </svg>
  );
};
