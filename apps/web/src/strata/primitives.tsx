import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { animate, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Counts up from 0 to `value` once the element scrolls into view. Honors
 * reduced-motion by rendering the target value immediately.
 */
export const CountUp = ({
  value,
  duration = 1.4,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    const ctrl = animate(0, value, {
      duration,
      ease: [0.2, 0.6, 0.2, 1],
      onUpdate: (v) => setN(Math.round(v)),
    });
    return () => ctrl.stop();
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={className}>
      {n}
    </span>
  );
};

type ChipVariant = "default" | "outline" | "solid" | "ghost" | "success" | "danger";

export const Chip = ({
  children,
  variant = "default",
  icon,
  className,
}: {
  children: ReactNode;
  variant?: ChipVariant;
  icon?: ReactNode;
  className?: string;
}) => (
  <span className={cn("chip", `chip-${variant}`, className)}>
    {icon && <span className="inline-flex">{icon}</span>}
    {children}
  </span>
);

const avatarPalette = [
  "#e8b341",
  "#e8331f",
  "#c87a3a",
  "#d4302a",
  "#6aa37a",
  "#a35e2a",
];

const avatarColor = (name: string): string => {
  const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return avatarPalette[hash % avatarPalette.length];
};

const avatarInitials = (name: string): string =>
  name
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export const Avatar = ({
  name,
  color,
  size = 36,
  ring = false,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) => {
  const c = color ?? avatarColor(name);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-mono font-semibold uppercase text-strata-bg",
        ring ? "ring-2 ring-strata-bg" : "",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        letterSpacing: "0.05em",
        background: c,
        borderRadius: 2,
        boxShadow: ring
          ? `0 0 0 2px var(--color-strata-bg), 0 0 0 3px ${c}`
          : "inset 0 0 0 1px rgb(0 0 0 / 0.18)",
      }}
    >
      {avatarInitials(name)}
    </div>
  );
};

export const GlassPanel = ({
  children,
  strong = false,
  className,
}: {
  children: ReactNode;
  strong?: boolean;
  className?: string;
}) => (
  <div
    className={cn(
      strong ? "glass-strong" : "glass",
      "p-5",
      className,
    )}
    style={{ borderRadius: 2 }}
  >
    {children}
  </div>
);

export const Skeleton = ({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) => (
  <div className={cn("skeleton", className)} style={{ borderRadius: 2, ...style }} />
);

export const ProgressBar = ({
  value,
  glow = true,
  className,
}: {
  value: number;
  glow?: boolean;
  className?: string;
}) => (
  <div
    className={cn(
      "h-[2px] w-full overflow-hidden bg-strata-paper/15",
      className,
    )}
  >
    <div
      className="h-full"
      style={{
        width: `${Math.max(0, Math.min(1, value)) * 100}%`,
        background: "var(--color-strata-accent)",
        boxShadow: glow ? "0 0 12px rgb(232 51 31 / 0.45)" : "none",
      }}
    />
  </div>
);

type BtnProps = {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  to?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
};

export const PrimaryBtn = ({
  children,
  icon,
  onClick,
  to,
  type,
  disabled,
  className,
}: BtnProps) => {
  const inner = (
    <>
      {icon && <span className="inline-flex">{icon}</span>}
      <span>{children}</span>
    </>
  );
  if (to)
    return (
      <Link to={to as never} className={cn("strata-btn-primary", className)}>
        {inner}
      </Link>
    );
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className={cn("strata-btn-primary", className)}
    >
      {inner}
    </button>
  );
};

export const SecondaryBtn = ({
  children,
  icon,
  onClick,
  to,
  type,
  disabled,
  className,
}: BtnProps) => {
  const inner = (
    <>
      {icon && <span className="inline-flex">{icon}</span>}
      <span>{children}</span>
    </>
  );
  if (to)
    return (
      <Link to={to as never} className={cn("strata-btn-secondary", className)}>
        {inner}
      </Link>
    );
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className={cn("strata-btn-secondary", className)}
    >
      {inner}
    </button>
  );
};

export const HeroBadge = ({ label }: { label: string }) => (
  <div className="border border-strata-paper/30 bg-strata-paper/10 px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-strata-paper backdrop-blur-xl">
    {label}
  </div>
);

export const RowHeader = ({
  title,
  sub,
  cta,
}: {
  title: string;
  sub?: string;
  cta?: ReactNode;
}) => (
  <div className="flex items-baseline gap-4">
    <h2
      className="font-display text-[24px] leading-none text-strata-paper"
      style={{
        fontVariationSettings: '"opsz" 48, "SOFT" 40',
        letterSpacing: "-0.03em",
      }}
    >
      {title}
    </h2>
    {sub && (
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">
        · {sub}
      </span>
    )}
    <div className="flex-1" />
    {cta && (
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-accent">
        {cta}
      </span>
    )}
  </div>
);

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.28em] text-strata-text/45">
    {children}
  </div>
);
