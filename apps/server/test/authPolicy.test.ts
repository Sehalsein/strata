import { expect, test } from "bun:test";
import { demoRefuses, viewerMayCall } from "../src/auth/betterAuth";

test("a watch-only sign-in may only tend its own sign-in and pick a household", () => {
  for (const path of ["/get-session", "/sign-out", "/sign-in/username", "/callback/:id", "/device/approve", "/organization/set-active", "/organization/get-full-organization", "/update-user", "/reset-password/:token"]) {
    expect(viewerMayCall(path)).toBe(true);
  }
  // Other sessions (their tokens), the admin plugin, the household's people, new ways in,
  // and anything a plugin adds later.
  for (const path of ["/list-sessions", "/revoke-session", "/admin/create-user", "/admin/list-users", "/organization/invite-member", "/organization/list-invitations", "/organization/accept-invitation", "/passkey/generate-register-options", "/link-social", "/delete-user", "/some-new-plugin/endpoint"]) {
    expect(viewerMayCall(path)).toBe(false);
  }
});

test("the demo refuses changes to its accounts and household, not signing in or watching", () => {
  for (const path of ["/change-password", "/update-user", "/admin/set-role", "/organization/invite-member", "/delete-user"]) expect(demoRefuses(path)).toBe(true);
  for (const path of ["/sign-in/username", "/get-session", "/sign-out", "/device/code", "/device/token", "/organization/list"]) expect(demoRefuses(path)).toBe(false);
});
