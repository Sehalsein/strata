import { useSyncExternalStore } from "react";
import {
  signInWithPassword,
  clearAuth,
  hasSession,
  getUserId,
  getUserName,
} from "./api";

const AUTH_EVENT = "strata.auth";

const emitter = new EventTarget();

const subscribe = (cb: () => void) => {
  const listener = () => cb();
  emitter.addEventListener(AUTH_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    emitter.removeEventListener(AUTH_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
};

const snapshot = (): SessionData | null => {
  if (!hasSession()) return null;
  const id = getUserId();
  const name = getUserName() ?? "User";
  if (!id) return null;
  return { user: { id, name } };
};

let cached: SessionData | null = snapshot();
const getSnapshot = (): SessionData | null => {
  const next = snapshot();
  if (
    cached?.user.id === next?.user.id &&
    cached?.user.name === next?.user.name
  ) {
    return cached;
  }
  cached = next;
  return cached;
};

export type SessionData = {
  user: { id: string; name: string };
};

export const useSession = (): {
  data: SessionData | null;
  isPending: boolean;
} => {
  const data = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return { data, isPending: false };
};

export const signIn = async (
  username: string,
  password: string,
): Promise<void> => {
  await signInWithPassword(username, password);
  emitter.dispatchEvent(new Event(AUTH_EVENT));
};

export const signOut = async (): Promise<void> => {
  clearAuth();
  emitter.dispatchEvent(new Event(AUTH_EVENT));
};
