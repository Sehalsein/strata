/**
 * One server, built two ways from this code:
 *
 * - **home** (the default; the Mac app and Linux binaries): keeps its state on this
 *   machine — a bundled database in the data folder (or any Postgres via DATABASE_URL),
 *   the secret key in a file beside it. Finds devices on the home network (Bonjour),
 *   lets them join without a password, plays local media folders through ffmpeg, and
 *   updates itself.
 * - **cloud** (the Docker image, `scripts/build.ts --mode cloud`): stateless. Everything
 *   lasting is in the Postgres named by DATABASE_URL (Neon), the secret key comes from
 *   STRATA_SECRET_KEY, and the disk only holds throwaway caches, so the container can be
 *   replaced or run twice. No Bonjour, no password-less join, no local folders, no
 *   self-update; client addresses come from the proxy in front (X-Forwarded-For).
 *
 * The build sets the mode (`STRATA_BUILD_MODE`); `STRATA_MODE` overrides it when running
 * from source.
 */
declare const STRATA_BUILD_MODE: string | undefined;

export type Mode = "home" | "cloud";

const built = typeof STRATA_BUILD_MODE === "string" ? STRATA_BUILD_MODE : undefined;

export const MODE: Mode = (process.env.STRATA_MODE ?? built) === "cloud" ? "cloud" : "home";
export const isCloud = MODE === "cloud";
