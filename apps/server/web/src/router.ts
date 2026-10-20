import { useEffect, useState } from "react";

// Minimal history-based router. The server falls back to index.html for unknown paths.

const listeners = new Set<() => void>();

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  for (const fn of listeners) fn();
  window.scrollTo(0, 0);
}

window.addEventListener("popstate", () => {
  for (const fn of listeners) fn();
});

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const fn = () => setPath(location.pathname);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return path;
}

/** Intercepts plain left-clicks so links behave like SPA navigation but still work as real links. */
export function linkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = e.currentTarget.getAttribute("href");
  if (!href || !href.startsWith("/")) return;
  e.preventDefault();
  navigate(href);
}
