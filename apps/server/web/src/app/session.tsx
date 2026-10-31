import { createContext, useContext } from "react";
import type { Me, ServerInfo } from "@/lib/types";

/** "systemAdmin": the backoffice, for whoever runs the server (set by the environment on the cloud). */
export type Access = "any" | "householdAdmin" | "serverAdmin" | "systemAdmin";

export interface Session {
  info: ServerInfo;
  me: Me;
  /** The system admin (made at setup; on the cloud, an email in STRATA_ADMIN_EMAILS): the backoffice. */
  isServerAdmin: boolean;
  /** The active household's owner or an admin: its library, settings, members. */
  isHouseholdAdmin: boolean;
  /** The hosted server: no folders, home-network join, Bonjour or self-update. */
  cloud: boolean;
  can: (access: Access) => boolean;
  /**
   * After a sign-in, sign-out, account or household switch: re-reads who's signed in and drops
   * every cached response, so nothing from the previous account or household shows.
   */
  authChanged: () => Promise<void>;
  /** Shows the sign-in form to add another account to this browser. */
  addAccount: () => void;
}

export const SessionContext = createContext<Session | null>(null);

/** The signed-in dashboard's server info, account and auth actions. */
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside the signed-in app");
  return s;
}

/** Like useSession, but null outside the signed-in app (public pages). */
export function useOptionalSession(): Session | null {
  return useContext(SessionContext);
}
