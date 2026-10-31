import { configureApiAuth, request } from "./api";

/*
 * Every auth/session concern lives here: creating the first admin, signing in and out, the
 * current user, changing the password, and how the session is stored and attached to requests.
 * Pages and the app shell only use `authClient` below.
 *
 * Today the server issues an opaque token that we keep in localStorage and send as a bearer
 * header. When the server moves to Better Auth, re-implement this module on top of
 * `createAuthClient()` from "better-auth/react" (plus `organizationClient()`), keeping the
 * `AuthClient` interface; cookie sessions mean `configureApiAuth` just stops adding a header.
 */

export interface AuthUser {
  id: number | string;
  username: string;
  isAdmin: boolean;
}

export interface AuthClient {
  /** True when this browser holds a session (it may still turn out to be expired). */
  hasSession(): boolean;
  /** First-run: create the admin account and sign in as it. */
  setupAdmin(input: { username: string; password: string; setupCode?: string }): Promise<void>;
  signIn(input: { username: string; password: string }): Promise<void>;
  /** Ends the session on the server (best effort) and forgets it here. */
  signOut(): Promise<void>;
  getCurrentUser(): Promise<AuthUser>;
  /** Rejects with ApiError 403 when `currentPassword` is wrong. Other devices are signed out. */
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  /** Called when the server rejects the session (expired, revoked). Returns an unsubscribe. */
  onSessionExpired(fn: () => void): () => void;
}

const TOKEN_KEY = "strata.token";
const DEVICE_NAME = "Dashboard";

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session lasts for this page only */
  }
  memoryToken = token;
}

// Fallback when localStorage throws (private mode, blocked storage).
let memoryToken: string | null = readToken();
const token = () => readToken() ?? memoryToken;

const expiredListeners = new Set<() => void>();

configureApiAuth({
  headers: (): Record<string, string> => {
    const t = token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  },
  onUnauthorized: () => {
    writeToken(null);
    for (const fn of expiredListeners) fn();
  },
});

export const authClient: AuthClient = {
  hasSession: () => !!token(),

  async setupAdmin({ username, password, setupCode }) {
    const r = await request<{ token: string }>(
      "POST",
      "/setup/admin",
      // setupCode is printed in the server log; the server may waive it for requests from its own machine.
      { username, password, deviceName: DEVICE_NAME, ...(setupCode ? { setupCode } : {}) },
      { auth: false },
    );
    writeToken(r.token);
  },

  async signIn({ username, password }) {
    const r = await request<{ token: string }>("POST", "/auth/login", { username, password, deviceName: DEVICE_NAME }, { auth: false });
    writeToken(r.token);
  },

  async signOut() {
    try {
      await request<{ ok: true }>("POST", "/auth/logout");
    } catch {
      /* the session may already be gone */
    }
    writeToken(null);
  },

  async getCurrentUser() {
    const r = await request<{ user: AuthUser }>("GET", "/me");
    return r.user;
  },

  async changePassword({ currentPassword, newPassword }) {
    await request<{ ok: true }>("POST", "/auth/password", { currentPassword, newPassword });
  },

  onSessionExpired(fn) {
    expiredListeners.add(fn);
    return () => {
      expiredListeners.delete(fn);
    };
  },
};
