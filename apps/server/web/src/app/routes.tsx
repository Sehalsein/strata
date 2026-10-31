import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { LayoutDashboard, Library, MonitorSmartphone, ScrollText, Settings, Tv, Users, type LucideIcon } from "lucide-react";
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
  component: LazyExoticComponent<ComponentType>;
}

export type NavGroup = "Dashboard" | "Media" | "People" | "System";
export const NAV_GROUPS: NavGroup[] = ["Dashboard", "Media", "People", "System"];

export const routes: AppRoute[] = [
  { path: "/", aliases: ["/overview"], title: "Overview", icon: LayoutDashboard, group: "Dashboard", access: "any", component: lazy(() => import("@/features/overview/overview-page")) },
  { path: "/library", title: "Library", icon: Library, group: "Media", access: "householdAdmin", component: lazy(() => import("@/features/library/library-page")) },
  { path: "/members", title: "Members", icon: Users, group: "People", access: "householdAdmin", component: lazy(() => import("@/features/members/members-page")) },
  { path: "/devices", title: "Devices", icon: MonitorSmartphone, group: "People", access: "any", component: lazy(() => import("@/features/devices/devices-page")) },
  { path: "/link", title: "Link a TV", icon: Tv, group: "People", access: "any", hidden: true, component: lazy(() => import("@/features/link/link-page")) },
  { path: "/settings", title: "Settings", icon: Settings, group: "System", access: "householdAdmin", component: lazy(() => import("@/features/settings/settings-page")) },
  { path: "/logs", title: "Logs", icon: ScrollText, group: "System", access: "serverAdmin", component: lazy(() => import("@/features/logs/logs-page")) },
];

export function matchRoute(pathname: string): AppRoute | undefined {
  const p = pathname.replace(/\/+$/, "") || "/";
  return routes.find((r) => {
    const paths = [r.path, ...(r.aliases ?? [])];
    return paths.some((rp) => (rp === "/" ? p === "/" : p === rp || p.startsWith(`${rp}/`)));
  });
}
