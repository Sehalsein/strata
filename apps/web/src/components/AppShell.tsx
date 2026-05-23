import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  animate,
  motion,
  LayoutGroup,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "motion/react";
import { useState } from "react";
import { useSession, signOut } from "@/lib/auth-client";
import { paletteFor, hexA } from "@/strata/theme";
import { AmbientProvider, useAmbient } from "@/strata/ambient";
import { TitleBackdrop } from "@/strata/Poster";
import { Avatar } from "@/strata/primitives";
import { I } from "@/strata/icons";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Index", match: "home", num: "00" },
  { to: "/movies", label: "Movies", match: "movies", num: "01" },
  { to: "/shows", label: "Shows", match: "shows", num: "02" },
  { to: "/search", label: "Search", match: "search", num: "03" },
] as const;

const activeIdFor = (pathname: string): string => {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/movies")) return "movies";
  if (pathname.startsWith("/shows")) return "shows";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/watch")) return "watch";
  return "";
};

const monthShort = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

const formatToday = (): string => {
  const d = new Date();
  return `${monthShort[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} · ${d.getFullYear()}`;
};

export const AppShell = () => {
  const { data: session } = useSession();
  if (!session) return <Outlet />;
  return (
    <AmbientProvider>
      <Shell />
    </AmbientProvider>
  );
};

const Shell = () => {
  const { data: session } = useSession();
  const { location } = useRouterState();
  const { paletteKey, paletteOverride, intensity } = useAmbient();
  const active = activeIdFor(location.pathname);

  useEffect(() => {
    const p =
      paletteOverride ?? (paletteKey ? paletteFor(paletteKey) : null);
    const root = document.documentElement.style;
    if (p) {
      root.setProperty("--strata-c1", p[0]);
      root.setProperty("--strata-c2", p[1]);
      root.setProperty("--strata-c3", p[2]);
      root.setProperty("--strata-c1-soft", hexA(p[0], 0.16 * intensity));
      root.setProperty("--strata-c2-soft", hexA(p[1], 0.1 * intensity));
    } else {
      root.setProperty("--strata-c1", "#2a1a10");
      root.setProperty("--strata-c2", "#0c0a08");
      root.setProperty("--strata-c3", "#e8b341");
      root.setProperty("--strata-c1-soft", "rgba(232,179,65,0.14)");
      root.setProperty("--strata-c2-soft", "rgba(232,51,31,0.08)");
    }
  }, [paletteKey, paletteOverride, intensity]);

  if (active === "watch") return <Outlet />;

  const userName = session?.user?.name || "Guest";

  return (
    <div className="strata relative min-h-screen text-strata-text">
      {/* Persistent ambient bloom — soft warm wash behind everything */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <TitleBackdrop paletteKey={paletteKey} paletteOverride={paletteOverride} />
      </div>
      {/* Persistent grain so the entire page feels printed */}
      <div className="grain-paper pointer-events-none fixed inset-0 z-[1] opacity-[0.5] mix-blend-overlay" />

      <Masthead active={active} userName={userName} />

      <main className="relative z-10 pt-[112px]">
        <Outlet />
      </main>

      <Colophon />
    </div>
  );
};

const Masthead = ({
  active,
  userName,
}: {
  active: string;
  userName: string;
}) => {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (latest) => {
    setScrolled(latest > 40);
  });

  const today = useMemo(formatToday, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        scrolled
          ? "bg-strata-bg/85 backdrop-blur-xl"
          : "bg-gradient-to-b from-strata-bg/95 via-strata-bg/55 to-transparent",
      )}
    >
      {/* Top spec strip — date / volume / time-of-day */}
      <div className="border-b rule-thin border-b-[color:rgb(243_233_211/0.1)]">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-6 px-8 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45 lg:px-12">
          <span className="flex items-center gap-3">
            <span className="anim-pulse-dot inline-block h-1 w-1 rounded-full bg-strata-accent" />
            <span className="text-strata-text/70">On Air</span>
            <span className="text-strata-text/30">·</span>
            <span>Vol. III</span>
          </span>
          <span className="hidden md:inline">{today}</span>
          <span className="flex items-center gap-3">
            <span className="text-strata-text/30">Est. MMXXVI</span>
            <span className="text-strata-text/30">·</span>
            <span className="text-strata-text/70">Strata Cinemathèque</span>
          </span>
        </div>
      </div>

      <div className="mx-auto flex h-[72px] max-w-[1680px] items-center gap-10 px-8 lg:px-12">
        <Wordmark />

        <span className="hidden h-6 w-px bg-strata-text/15 lg:inline-block" />

        <LayoutGroup id="nav-underline-group">
          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((it) => {
              const isActive = it.match === active;
              return (
                <Link
                  key={it.to}
                  to={it.to as never}
                  className={cn(
                    "group/nav relative px-3.5 py-2 no-underline transition-colors duration-200",
                    isActive
                      ? "text-strata-paper"
                      : "text-strata-text/45 hover:text-strata-paper",
                  )}
                >
                  <span className="mr-2 inline-block font-mono text-[9px] uppercase tracking-[0.2em] text-strata-text/35 group-hover/nav:text-strata-text/65">
                    {it.num}
                  </span>
                  <span
                    className="font-display text-[17px]"
                    style={{
                      fontVariationSettings: '"opsz" 14, "SOFT" 80',
                      fontStyle: isActive ? "italic" : "normal",
                    }}
                  >
                    {it.label}
                  </span>
                  {isActive && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute inset-x-3 -bottom-[3px] h-[2px] rounded-none bg-strata-accent"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </LayoutGroup>

        <div className="flex-1" />

        <NavIcon icon={I.search} to="/search" />
        <NavIcon icon={I.bell} dot />
        <span className="hidden h-6 w-px bg-strata-text/15 sm:inline-block" />
        <UserMenu name={userName} />
      </div>
    </header>
  );
};

const NavIcon = ({
  icon,
  to,
  dot,
}: {
  icon: ReactNode;
  to?: string;
  dot?: boolean;
}) => {
  const inner = (
    <motion.div
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className="relative inline-flex h-9 w-9 items-center justify-center text-strata-text/55 hover:text-strata-paper transition-colors"
    >
      {icon}
      {dot && (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-strata-accent shadow-[0_0_8px_var(--color-strata-accent)]" />
      )}
    </motion.div>
  );
  if (to) {
    return (
      <Link to={to as never} className="no-underline">
        {inner}
      </Link>
    );
  }
  return inner;
};

const UserMenu = ({ name }: { name: string }) => (
  <motion.button
    whileHover={{ scale: 1.04 }}
    whileTap={{ scale: 0.92 }}
    transition={{ type: "spring", stiffness: 320, damping: 22 }}
    onClick={() => signOut().then(() => window.location.reload())}
    className="group flex items-center gap-2.5 border-none bg-transparent p-1 cursor-pointer"
    aria-label="Sign out"
  >
    <Avatar name={name} size={30} />
    <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-strata-text/55 group-hover:text-strata-paper sm:inline">
      {name.split(/\s+/)[0]}
    </span>
  </motion.button>
);

/**
 * Wordmark — the "Strata" logotype + opus number. On hover, the variable-font
 * SOFT and WONK axes flex outward (rounder, more idiosyncratic) and snap back
 * on leave. Uses motion values so the axes interpolate smoothly across the
 * intermediate integer values the font actually supports.
 */
const Wordmark = () => {
  const [hovered, setHovered] = useState(false);
  const soft = useMotionValue(30);
  const wonk = useMotionValue(1);
  const ctrlRef = useRef<{ stop: () => void }[]>([]);

  useEffect(() => {
    ctrlRef.current.forEach((c) => c.stop());
    ctrlRef.current = [
      animate(soft, hovered ? 100 : 30, { duration: 0.55, ease: "easeOut" }),
      animate(wonk, hovered ? 0 : 1, { duration: 0.55, ease: "easeOut" }),
    ];
    return () => ctrlRef.current.forEach((c) => c.stop());
  }, [hovered, soft, wonk]);

  const fvs = useTransform(
    [soft, wonk],
    ([s, w]: number[]) =>
      `"opsz" 144, "SOFT" ${(s as number).toFixed(0)}, "WONK" ${(w as number).toFixed(2)}`,
  );

  return (
    <Link
      to="/"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="group flex items-baseline gap-3 no-underline"
    >
      <motion.span
        className="font-display text-[34px] leading-none text-strata-paper"
        style={{
          fontVariationSettings: fvs,
          letterSpacing: "-0.04em",
        }}
      >
        Strata
      </motion.span>
      <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-strata-text/40">
        № 00.01
      </span>
    </Link>
  );
};

const Colophon = () => (
  <footer className="relative z-10 mt-24 border-t rule-thin px-8 py-10 lg:px-12">
    <div className="mx-auto flex max-w-[1680px] flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <span
            className="font-display text-[28px] leading-none text-strata-paper"
            style={{
              fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
              letterSpacing: "-0.04em",
            }}
          >
            Strata
          </span>
          <span className="font-editorial text-[15px] text-strata-text/55">
            cinemathèque
          </span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">
          A private repertory · est. MMXXVI · printed in the dark
        </div>
      </div>
      <div className="border-t rule-thin pt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-strata-text/30">
        Personal media library / not for redistribution / handle with care
      </div>
    </div>
  </footer>
);
