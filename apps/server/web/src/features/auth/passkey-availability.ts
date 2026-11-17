import type { ServerInfo } from "@/lib/types";

/**
 * Whether passkeys work on this page. Browsers only allow them over HTTPS (or at
 * http://localhost), at a hostname rather than an IP address, and a passkey belongs to the
 * domain it was made on, so the server answers with the one address they work at
 * (`passkeyAddress`). Anywhere else, the dashboard says why instead of offering a button that
 * fails.
 * - `null`: this server isn't set up for passkeys (nothing to show).
 * - `{ ok: true }`: offer them. `localOnly` when they belong to localhost: they work on the
 *   server's own computer only.
 * - `{ ok: false, reason, address }`: explain; `address` is where to open Strata instead (none
 *   when that's the server's own localhost, which isn't this device's).
 */
export type PasskeyAvailability = { ok: true; localOnly: boolean } | { ok: false; reason: string; address: string | null } | null;

const IP = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

export function passkeyAvailability(signIn: ServerInfo["signIn"], page: Location = window.location): PasskeyAvailability {
  if (!signIn?.passkey) return null;
  const address = signIn.passkeyAddress ?? null;
  const localOnly = signIn.passkeyDomain === "localhost";
  const unavailable = (reason: string) => ({ ok: false as const, reason, address: localOnly ? null : address });
  if (typeof window.PublicKeyCredential === "undefined") return unavailable("This browser doesn't support passkeys.");
  if (!address || page.origin === address) return { ok: true, localOnly };

  const elsewhere = localOnly
    ? `On this server they work only at ${address}, on the computer it runs on. To use them from other devices, give the server an HTTPS address and set STRATA_PUBLIC_URL to it.`
    : `Open Strata at ${address} to use them.`;
  if (IP.test(page.hostname)) return unavailable(`Passkeys need the server's name, not an IP address. ${elsewhere}`);
  if (!window.isSecureContext) return unavailable(`Passkeys need a secure (HTTPS) connection. ${elsewhere}`);
  const domain = signIn.passkeyDomain ?? "";
  const underDomain = page.hostname === domain || page.hostname.endsWith(`.${domain}`);
  return unavailable(underDomain ? `Passkeys work at ${address}, not this address.` : `Passkeys belong to ${domain}, not this address. ${elsewhere}`);
}

/** The browser can offer passkeys in the username field's autofill (conditional UI). */
export async function passkeyAutofillAvailable(): Promise<boolean> {
  try {
    return (await window.PublicKeyCredential?.isConditionalMediationAvailable?.()) ?? false;
  } catch {
    return false;
  }
}
