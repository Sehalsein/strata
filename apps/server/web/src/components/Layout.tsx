import type { ReactNode } from "react";
import { linkClick } from "../router";

const NAV: { href: string; label: string; icon: ReactNode; match: (p: string) => boolean }[] = [
  {
    href: "/",
    label: "Overview",
    match: (p) => p === "/" || p === "/overview",
    icon: <path d="M3 10.5h4v6H3zM8 4h4v12.5H8zM13 7.5h4v9h-4z" />,
  },
  {
    href: "/library",
    label: "Library",
    match: (p) => p.startsWith("/library"),
    icon: <path d="M3.5 4h3v12h-3zM8.5 4h3v12h-3zM13.2 4.6l2.8-.8 2.6 11.6-2.8.8z" />,
  },
  {
    href: "/settings",
    label: "Settings",
    match: (p) => p.startsWith("/settings"),
    icon: <path d="M3 6h9M15 6h2M3 14h3M9 14h8M12 4v4M6 12v4" />,
  },
  {
    href: "/profiles",
    label: "Profiles",
    match: (p) => p.startsWith("/profiles"),
    icon: <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" />,
  },
  {
    href: "/devices",
    label: "Devices",
    match: (p) => p.startsWith("/devices"),
    icon: <path d="M3 5h10v8H3zM6 16h4M15 7h3v9h-3z" />,
  },
  {
    href: "/logs",
    label: "Logs",
    match: (p) => p.startsWith("/logs"),
    icon: <path d="M4 5h12M4 9h12M4 13h8M4 17h5" />,
  },
];

export function Layout({ path, serverName, version, onSignOut, children }: { path: string; serverName: string; version?: string; onSignOut: () => void; children: ReactNode }) {
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <span className="brand-name">Strata</span>
            {serverName !== "Strata" && (
              <span className="brand-server" title={serverName}>
                {serverName}
              </span>
            )}
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => {
            const active = item.match(path);
            return (
              <a key={item.href} href={item.href} className={`nav-link ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={linkClick}>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="nav-icon">
                  {item.icon}
                </svg>
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {version && <span className="mono muted small">v{version}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Strata</span>
          <span className="brand-server" title={serverName}>
            {serverName !== "Strata" ? serverName : ""}
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>

      <nav className="tabbar" aria-label="Main">
        {NAV.map((item) => {
          const active = item.match(path);
          return (
            <a key={item.href} href={item.href} className={`tab ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={linkClick}>
              <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true" className="nav-icon">
                {item.icon}
              </svg>
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

/** The Strata mark: three bands (sand, apricot, rust) that form a play triangle. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="292 254 476 516" width={size} height={size} aria-hidden="true">
      <g strokeLinejoin="round" strokeWidth="16">
        <path d="M300 262 L552 399 L300 399 Z" fill="var(--sand)" stroke="var(--sand)" />
        <path d="M300 443 L633 443 L760 512 L633 581 L300 581 Z" fill="var(--accent)" stroke="var(--accent)" />
        <path d="M300 625 L552 625 L300 762 Z" fill="var(--rust)" stroke="var(--rust)" />
      </g>
    </svg>
  );
}
