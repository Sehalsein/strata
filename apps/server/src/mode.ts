/**
 * One server, built two ways from this code:
 *
 * - **home** (single-tenant, self-hosted; the default; the Mac app and Linux binaries):
 *   its first run makes the server's admin (with the setup code from its log), and
 *   households grow by invitation. Keeps its state on this machine — a bundled database in
 *   the data folder (or any Postgres via DATABASE_URL), the secret key in a file beside it.
 *   Finds devices on the home network (Bonjour), lets them join without a password, plays
 *   local media folders through ffmpeg, and updates itself.
 * - **cloud** (multi-tenant, hosted; the Worker, or `scripts/build.ts --mode cloud`): no
 *   server setup. Anyone signs up and gets a household of their own, set up in onboarding;
 *   invitations add people to it; STRATA_ADMIN_EMAILS name the server's admins. Stateless:
 *   everything lasting is in the Postgres named by DATABASE_URL (Neon), the secret key
 *   comes from STRATA_SECRET_KEY, and the disk only holds throwaway caches, so instances
 *   can be replaced or run side by side. No Bonjour, no password-less join, no local
 *   folders or ffmpeg, no self-update; client addresses come from the proxy in front.
 *
 * The build fixes the mode (`STRATA_BUILD_MODE`): a built server can't be switched while
 * it runs, so a home server never opens sign-up and a cloud one never asks for setup.
 * Only from source (tests, `bun run dev`), with no build, does `STRATA_MODE` choose.
 */
declare const STRATA_BUILD_MODE: string | undefined;

export type Mode = "home" | "cloud";

const built = typeof STRATA_BUILD_MODE === "string" ? STRATA_BUILD_MODE : undefined;

export const MODE: Mode = (built ?? process.env.STRATA_MODE) === "cloud" ? "cloud" : "home";
