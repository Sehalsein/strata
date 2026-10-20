import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

/** Bumped when the HTTP API changes incompatibly. Clients check it via /api/info. */
export const API_VERSION = 1;
