import { createContext, useContext } from "react";
import type { ServerInfo } from "@/lib/types";

export interface Session {
  info: ServerInfo;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

/** The signed-in dashboard's server info and sign-out action. */
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside the signed-in app");
  return s;
}
