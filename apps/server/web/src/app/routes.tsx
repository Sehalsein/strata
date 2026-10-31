import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { LayoutDashboard, Library, MonitorSmartphone, ScrollText, Settings, Users, type LucideIcon } from "lucide-react";

/**
 * The route table. Adding an admin page is one entry here plus a folder under src/features:
 * the sidebar, the top bar title and code splitting all come from this list.
 */
export interface AppRoute {
  /** First path segment the route owns ("/" for the overview). */
  path: string;
  /** Extra paths that render the same page. */
  aliases?: string[];
  title: string;
  icon: LucideIcon;
  group: NavGroup;
  component: LazyExoticComponent<ComponentType>;
}

export type NavGroup = "Dashboard" | "Media" | "People" | "System";
export const NAV_GROUPS: NavGroup[] = ["Dashboard", "Media", "People", "System"];

export const routes: AppRoute[] = [
  { path: "/", aliases: ["/overview"], title: "Overview", icon: LayoutDashboard, group: "Dashboard", component: lazy(() => import("@/features/overview/overview-page")) },
  { path: "/library", title: "Library", icon: Library, group: "Media", component: lazy(() => import("@/features/library/library-page")) },
  { path: "/profiles", title: "Profiles", icon: Users, group: "People", component: lazy(() => import("@/features/profiles/profiles-page")) },
  { path: "/devices", title: "Devices", icon: MonitorSmartphone, group: "People", component: lazy(() => import("@/features/devices/devices-page")) },
  { path: "/settings", title: "Settings", icon: Settings, group: "System", component: lazy(() => import("@/features/settings/settings-page")) },
  { path: "/logs", title: "Logs", icon: ScrollText, group: "System", component: lazy(() => import("@/features/logs/logs-page")) },
];

export function matchRoute(pathname: string): AppRoute | undefined {
  const p = pathname.replace(/\/+$/, "") || "/";
  return routes.find((r) => {
    const paths = [r.path, ...(r.aliases ?? [])];
    return paths.some((rp) => (rp === "/" ? p === "/" : p === rp || p.startsWith(`${rp}/`)));
  });
}
