import { createAuthClient } from "better-auth/react";
import { adminClient, deviceAuthorizationClient, multiSessionClient, organizationClient, usernameClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ApiError, configureApiAuth, request } from "./api";
import type { AuthSession, SavedPasskey, DeviceAccount, DeviceCodeInfo, FullHousehold, HouseholdRole, HouseholdSummary, Invitation, Me } from "./types";

/*
 * Every auth/session concern lives here. Accounts, sign-in, households (Better Auth
 * organizations), members, invitations, saved sign-ins on this browser (multi-session) and
 * TV approval are Better Auth's, at /api/auth/*. The dashboard is same-origin, so sessions
 * are cookies: Strata's own /api calls need no header, and `configureApiAuth` only hears
 * about expired sessions. Pages and the shell use `authClient` below, never Better Auth.
 */

const ba = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [usernameClient(), organizationClient(), adminClient(), multiSessionClient(), deviceAuthorizationClient(), passkeyClient()],
});

/** A Better Auth error: `{message, code}`, or the device flow's `{error, error_description}`. */
export class AuthError extends ApiError {
  constructor(
    message: string,
    status: number,
    readonly code?: string,
  ) {
    super(message, status);
  }
}

type BaError = { message?: string; code?: string; error?: string; error_description?: string; status: number; statusText?: string };
type BaResult<T> = { data: T | null; error: BaError | null } | { data: T; error: null };

async function call<T>(p: Promise<BaResult<T>>): Promise<T> {
  let r: BaResult<T>;
  try {
    r = await p;
  } catch {
    throw new AuthError("Can't reach the server", 0);
  }
  if (r.error) {
    const e = r.error;
    const message = e.message || e.error_description || (e.status === 429 ? "Too many attempts. Try again in a few minutes." : e.statusText) || `Request failed (${e.status})`;
    throw new AuthError(message, e.status, e.code ?? e.error);
  }
  return r.data as T;
}

const expiredListeners = new Set<() => void>();
configureApiAuth({
  headers: () => ({}),
  onUnauthorized: () => {
    for (const fn of expiredListeners) fn();
  },
});

// The household this browser last chose for each account, used when a new sign-in has none
// (Better Auth opens a household by itself only when the account has just one).
const householdKey = (userId: string) => `strata.household.${userId}`;
function rememberHousehold(userId: string, householdId: string) {
  try {
    localStorage.setItem(householdKey(userId), householdId);
  } catch {
    /* storage unavailable: the first household is picked next time */
  }
}
function rememberedHousehold(userId: string): string | null {
  try {
    return localStorage.getItem(householdKey(userId));
  } catch {
    return null;
  }
}

async function fetchMe(): Promise<Me | null> {
  try {
    return await request<Me>("GET", "/me", undefined, { auth: false });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const authClient = {
  /**
   * Who's signed in on this browser (null when nobody is). A sign-in without a household
   * opens the one last chosen here, or the account's first.
   */
  async getMe(): Promise<Me | null> {
    const me = await fetchMe();
    if (!me || me.household) return me;
    const households = await authClient.listHouseholds().catch(() => []);
    if (households.length === 0) return me;
    const remembered = rememberedHousehold(me.user.id);
    const pick = households.find((h) => h.id === remembered) ?? households[0]!;
    await authClient.setActiveHousehold(pick.id);
    return fetchMe();
  },

  /** First run: the server admin's account and household, then a cookie sign-in as it. */
  async setupAdmin(input: { username: string; password: string; email?: string; householdName?: string; setupCode?: string }) {
    const r = await request<{ token: string; householdId: string }>("POST", "/setup/admin", input, { auth: false });
    await authClient.signIn({ username: input.username, password: input.password });
    // Setup's own sign-in was a bearer token for this call only; the cookie session replaces it.
    // The bearer form is "<session token>.<signature>"; sessions are revoked by the former.
    await call(ba.revokeSession({ token: r.token.split(".")[0]! })).catch(() => {});
  },

  /** Signs in by username (or email). With someone already signed in, adds this account. */
  async signIn({ username, password }: { username: string; password: string }) {
    if (username.includes("@")) await call(ba.signIn.email({ email: username, password }));
    else await call(ba.signIn.username({ username, password }));
  },

  /**
   * Signs in with Google (only an account that connected it): leaves for Google and comes
   * back to the dashboard, with `?auth_error=` when it didn't work.
   */
  async signInWithGoogle() {
    const back = `${window.location.origin}/`;
    await call(ba.signIn.social({ provider: "google", callbackURL: back, errorCallbackURL: `${back}?auth_error=google` }) as Promise<BaResult<unknown>>);
  },

  /** Signs in with a passkey saved on this device or a phone nearby. */
  async signInWithPasskey() {
    await call(ba.signIn.passkey() as Promise<BaResult<unknown>>);
  },

  /** Emails a reset link when an account has that address (the answer is the same either way). */
  async requestPasswordReset(email: string) {
    await call(ba.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` }) as Promise<BaResult<unknown>>);
  },

  /** Sets a new password with the token from an emailed reset link. */
  async resetPassword(token: string, newPassword: string) {
    await call(ba.resetPassword({ token, newPassword }) as Promise<BaResult<unknown>>);
  },

  /** Deletes the signed-in account and everything kept about it (needs its password). */
  async deleteAccount(password: string) {
    await call(ba.deleteUser({ password }) as Promise<BaResult<unknown>>);
  },

  // Sign-in methods of the signed-in account

  /** Whether the account has Google connected. */
  async googleConnected(): Promise<boolean> {
    const accounts = await call(ba.listAccounts() as Promise<BaResult<{ providerId: string }[]>>);
    return accounts.some((a) => a.providerId === "google");
  },

  /** Connects Google to the signed-in account (leaves for Google and comes back). */
  async connectGoogle() {
    await call(ba.linkSocial({ provider: "google", callbackURL: `${window.location.origin}/?google=connected` }) as Promise<BaResult<unknown>>);
  },

  async disconnectGoogle() {
    // Better Auth unlinks by its own id for the connection (not Google's account id).
    const accounts = await call(ba.listAccounts() as Promise<BaResult<{ id: string; providerId: string }[]>>);
    const google = accounts.find((a) => a.providerId === "google");
    if (google) await call(ba.unlinkAccount({ accountId: google.id }) as Promise<BaResult<unknown>>);
  },

  async listPasskeys(): Promise<SavedPasskey[]> {
    return call(ba.passkey.listUserPasskeys() as Promise<BaResult<SavedPasskey[]>>);
  },

  /** Saves a passkey for the signed-in account (the browser asks to create one). */
  async addPasskey(name: string) {
    await call(ba.passkey.addPasskey({ name }) as Promise<BaResult<unknown>>);
  },

  async deletePasskey(id: string) {
    await call(ba.passkey.deletePasskey({ id }) as Promise<BaResult<unknown>>);
  },

  /** Cloud: a new account, which the server gives a household of its own (signed in, in it). */
  async createAccount(input: { email: string; username: string; name: string; password: string }) {
    await call(ba.$fetch<unknown>("/sign-up/email", { method: "POST", body: input }) as Promise<BaResult<unknown>>);
  },

  /** Joins by invitation: a new account, the invitation accepted, its household opened. */
  async signUp(input: { email: string; username: string; name: string; password: string; invitationId: string }) {
    await call(ba.$fetch<unknown>("/sign-up/email", { method: "POST", body: input }) as Promise<BaResult<unknown>>);
    await authClient.acceptInvitation(input.invitationId);
  },

  async acceptInvitation(invitationId: string) {
    const r = await call(ba.organization.acceptInvitation({ invitationId }));
    const householdId = (r as { invitation?: { organizationId?: string } } | null)?.invitation?.organizationId;
    if (householdId) await authClient.setActiveHousehold(householdId);
  },

  /** Signs every account on this browser out. */
  async signOutAll() {
    await call(ba.signOut()).catch(() => {});
  },

  /** Signs one saved account out of this browser; the next saved one (if any) becomes active. */
  async signOutAccount(sessionToken: string) {
    await call(ba.multiSession.revoke({ sessionToken }));
  },

  /** The accounts signed in on this browser. */
  async listAccounts(): Promise<DeviceAccount[]> {
    return call(ba.multiSession.listDeviceSessions() as Promise<BaResult<DeviceAccount[]>>);
  },

  async switchAccount(sessionToken: string) {
    await call(ba.multiSession.setActive({ sessionToken }));
  },

  /** The token of this browser's active session (to mark "this browser" in session lists). */
  async currentSessionToken(): Promise<string | null> {
    const r = await call(ba.getSession() as Promise<BaResult<{ session: { token: string } } | null>>);
    return r?.session.token ?? null;
  },

  /** Rejects with code INVALID_PASSWORD when `currentPassword` is wrong. Other sessions are signed out. */
  async changePassword({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) {
    await call(ba.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }));
  },

  /**
   * Sets a temporary password for someone in the household (Better Auth's admin
   * set-user-password; the server allows it only over someone below you). They're signed
   * out everywhere and choose a new password at their next sign-in.
   */
  async setTemporaryPassword(userId: string, newPassword: string) {
    await call(ba.admin.setUserPassword({ userId, newPassword }) as Promise<BaResult<unknown>>);
  },

  /**
   * Deletes someone's account and everything kept about them (Better Auth's admin
   * remove-user; the server allows it only over someone below you in the household).
   */
  async deleteMemberAccount(userId: string) {
    await call(ba.admin.removeUser({ userId }) as Promise<BaResult<unknown>>);
  },

  /** Every sign-in of the current account (apps, TVs, browsers). */
  async listSessions(): Promise<AuthSession[]> {
    return call(ba.listSessions() as Promise<BaResult<AuthSession[]>>);
  },

  async revokeSession(token: string) {
    await call(ba.revokeSession({ token }));
  },

  // Households

  async listHouseholds(): Promise<HouseholdSummary[]> {
    return call(ba.organization.list() as Promise<BaResult<HouseholdSummary[]>>);
  },

  /** Opens a household on this browser's session (and remembers it for this account). */
  async setActiveHousehold(householdId: string) {
    await call(ba.organization.setActive({ organizationId: householdId }));
    const session = await call(ba.getSession() as Promise<BaResult<{ user: { id: string } } | null>>).catch(() => null);
    if (session) rememberHousehold(session.user.id, householdId);
  },

  /** The active household with its members and invitations. */
  async getHousehold(): Promise<FullHousehold> {
    return call(ba.organization.getFullOrganization() as Promise<BaResult<FullHousehold>>);
  },

  /** The server admin makes a household (and becomes its owner). */
  async createHousehold(name: string): Promise<HouseholdSummary> {
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "home"}-${Math.random().toString(36).slice(2, 8)}`;
    return call(ba.organization.create({ name, slug, keepCurrentActiveOrganization: true }) as Promise<BaResult<HouseholdSummary>>);
  },

  /** Renames a household (its owner and admins). */
  async renameHousehold(householdId: string, name: string): Promise<HouseholdSummary> {
    return call(ba.organization.update({ organizationId: householdId, data: { name } }) as Promise<BaResult<HouseholdSummary>>);
  },

  async invite(input: { email: string; role: HouseholdRole; householdId?: string }): Promise<Invitation> {
    return call(
      ba.organization.inviteMember({ email: input.email, role: input.role, ...(input.householdId ? { organizationId: input.householdId } : {}) }) as Promise<BaResult<Invitation>>,
    );
  },

  async cancelInvitation(invitationId: string) {
    await call(ba.organization.cancelInvitation({ invitationId }));
  },

  async removeMember(memberId: string) {
    await call(ba.organization.removeMember({ memberIdOrEmail: memberId }));
  },

  async setMemberRole(memberId: string, role: HouseholdRole) {
    await call(ba.organization.updateMemberRole({ memberId, role }));
  },

  // TVs (device authorization)

  /** Looks a TV's code up; doing so while signed in claims it for this account. */
  async lookUpDeviceCode(userCode: string): Promise<DeviceCodeInfo> {
    return call(ba.device({ query: { user_code: userCode } }) as Promise<BaResult<DeviceCodeInfo>>);
  },

  async approveDevice(userCode: string) {
    await call(ba.device.approve({ userCode }));
  },

  async denyDevice(userCode: string) {
    await call(ba.device.deny({ userCode }));
  },

  /** Called when the server rejects the session (expired, revoked). Returns an unsubscribe. */
  onSessionExpired(fn: () => void): () => void {
    expiredListeners.add(fn);
    return () => {
      expiredListeners.delete(fn);
    };
  },
};

export type AuthClient = typeof authClient;

/** The invitation link to pass on (no mail is sent). */
export function invitationLink(invitationId: string): string {
  return `${window.location.origin}/invite/${invitationId}`;
}

export const isHouseholdAdmin = (role: string | null | undefined) => !!role && role.split(",").some((r) => r === "owner" || r === "admin");
