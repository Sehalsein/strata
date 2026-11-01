import { forwardRef, useEffect, useState, type AnchorHTMLAttributes } from "react";

// Minimal history-based router. The server falls back to index.html for unknown paths, and
// the route table lives in src/app/routes.tsx.

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search + location.hash) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  emit();
  const hash = to.split("#")[1];
  if (!hash) window.scrollTo(0, 0);
}

window.addEventListener("popstate", emit);

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

/** An <a> that navigates client-side. Works with `asChild` on Button / SidebarMenuButton. */
export const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>(function Link({ onClick, ...props }, ref) {
  return (
    <a
      ref={ref}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        linkClick(e);
      }}
    />
  );
});
