import pkg from "../package.json" with { type: "json" };

// Defined at compile time by scripts/build.ts (`--version`, `--update-url`); absent in dev.
declare const STRATA_BUILD_VERSION: string | undefined;
declare const STRATA_UPDATE_URL: string | undefined;

export const VERSION: string = typeof STRATA_BUILD_VERSION === "string" ? STRATA_BUILD_VERSION : pkg.version;

/** Bumped when the HTTP API changes incompatibly. Clients check it via /api/info. */
export const API_VERSION = 1;

/**
 * The update feed this binary was built for, e.g. `https://updates.example.com/server` (stable)
 * or `…/server/nightly` (nightly). Empty in dev builds, which therefore never self-update.
 */
const BAKED_UPDATE_URL = (typeof STRATA_UPDATE_URL === "string" ? STRATA_UPDATE_URL : "").replace(/\/+$/, "");
const NIGHTLY_SUFFIX = /\/nightly$/;

/** The channel the binary was published to; the default for the `updateChannel` setting. */
export const BUILD_CHANNEL: "stable" | "nightly" = NIGHTLY_SUFFIX.test(BAKED_UPDATE_URL) ? "nightly" : "stable";

/** Feed root shared by both channels: `<base>/manifest.json` is stable, `<base>/nightly/manifest.json` nightly. */
export const UPDATE_BASE_URL: string = BAKED_UPDATE_URL.replace(NIGHTLY_SUFFIX, "");
