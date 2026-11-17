import { useSyncExternalStore } from "react";

/** A tiny pathname router: the site is a handful of articles, each at its own path. */

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Not in the browser when the build renders articles for llms.txt.
if (typeof window !== "undefined") addEventListener("popstate", notify);

export function navigate(to: string) {
  const url = new URL(to, location.href);
  if (url.pathname === location.pathname && url.hash) {
    history.pushState(null, "", url);
    document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  history.pushState(null, "", url);
  notify();
  if (url.hash) requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
  else scrollTo({ top: 0 });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname.replace(/\/+$/, "") || "/");
}
