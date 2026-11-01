import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Activity, LayoutDashboard, Library, MonitorSmartphone, ScrollText, Server, Settings, Tv, Users, type LucideIcon } from "lucide-react";
import type { Access } from "./session";

/**
 * The route table. Adding an admin page is one entry here plus a folder under src/features:
 * the sidebar, the top bar title and code splitting all come from this list. `access` hides a
 * page (and its nav item) from people who can't use it.
 */
export interface AppRoute {
  /** First path segment the route owns ("/" for the overview). */
  path: string;
  /** Extra paths that render the same page. */
  aliases?: string[];
  title: string;
  icon: LucideIcon;
  group: NavGroup;
  access: Access;
  /** Reached by a link, not the sidebar (a TV's QR code opens /link). */
  hidden?: boolean;
  /** The backoffice: the system admin's pages, with a sidebar of their own. */
  backoffice?: boolean;
  component: LazyExoticComponent<ComponentType>;
}

export type NavGroup = "Dashboard" | "Media" | "People" | "System" | "Server";
export const NAV_GROUPS: NavGroup[] = ["Dashboard", "Media", "People", "System"];
export const BACKOFFICE_GROUPS: NavGroup[] = ["Server"];

export const routes: AppRoute[] = [
  { path: "/", aliases: ["/overview"], title: "Overview", icon: LayoutDashboard, group: "Dashboard", access: "any", component: lazy(() => import("@/features/overview/overview-page")) },
  { path: "/library", title: "Library", icon: Library, group: "Media", access: "householdAdmin", component: lazy(() => import("@/features/library/library-page")) },
  { path: "/members", title: "Members", icon: Users, group: "People", access: "householdAdmin", component: lazy(() => import("@/features/members/members-page")) },
  { path: "/devices", title: "Devices", icon: MonitorSmartphone, group: "People", access: "any", component: lazy(() => import("@/features/devices/devices-page")) },
  { path: "/link", title: "Link a TV", icon: Tv, group: "People", access: "any", hidden: true, component: lazy(() => import("@/features/link/link-page")) },
  { path: "/settings", title: "Settings", icon: Settings, group: "System", access: "householdAdmin", component: lazy(() => import("@/features/settings/settings-page")) },
  { path: "/backoffice", title: "Status", icon: Activity, group: "Server", access: "systemAdmin", backoffice: true, component: lazy(() => import("@/features/backoffice/status-page")) },
  { path: "/backoffice/settings", title: "Server settings", icon: Server, group: "Server", access: "systemAdmin", backoffice: true, component: lazy(() => import("@/features/backoffice/server-settings-page")) },
  { path: "/backoffice/logs", aliases: ["/logs"], title: "Logs", icon: ScrollText, group: "Server", access: "systemAdmin", backoffice: true, component: lazy(() => import("@/features/logs/logs-page")) },
];

/** The route owning `pathname`: the longest path that matches (/backoffice/logs over /backoffice). */
export function matchRoute(pathname: string): AppRoute | undefined {
  const p = pathname.replace(/\/+$/, "") || "/";
  let best: { route: AppRoute; length: number } | undefined;
  for (const r of routes) {
    for (const rp of [r.path, ...(r.aliases ?? [])]) {
      const hit = rp === "/" ? p === "/" : p === rp || p.startsWith(`${rp}/`);
      if (hit && (!best || rp.length > best.length)) best = { route: r, length: rp.length };
    }
  }
  return best?.route;
}
