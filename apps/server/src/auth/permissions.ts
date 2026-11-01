import type { DeploymentProfile } from "../profile";

/**
 * Who may do what, in one place: the API's middleware (api/context.ts), Better Auth's hooks
 * (betterAuth.ts) and /api/me (which publishes the answers, so the dashboard and apps don't
 * parse roles themselves) all ask here.
 */

/** Owner 2, admin 1, member 0. Better Auth keeps a member's roles comma-joined. */
export function roleRank(role: string | null | undefined): number {
  const roles = (role ?? "").split(",");
  return roles.includes("owner") ? 2 : roles.includes("admin") ? 1 : 0;
}

export interface Permissions {
  /** Run the household: its members, library, settings and keys. */
  administerHousehold: boolean;
  /** Run the server: its settings, logs, households (the server's admin). */
  administerServer: boolean;
  /** Change anything at all (not in the public demo). */
  change: boolean;
}

/**
 * What a sign-in may do. A device that joined without a password, or a TV, only watches,
 * whoever it signed in as.
 */
export function permissionsOf(profile: DeploymentProfile, who: { viewerOnly: boolean; role: string | null; isServerAdmin: boolean }): Permissions {
  const change = !profile.readOnly;
  const signedInProperly = !who.viewerOnly;
  return {
    administerHousehold: change && signedInProperly && roleRank(who.role) >= 1,
    administerServer: change && signedInProperly && who.isServerAdmin,
    change,
  };
}
