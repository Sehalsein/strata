import { runtime } from "#runtime";

/**
 * Whether work one request started may be awaited by another. Not on Workers: they cancel
 * a request's I/O when its client goes away, so the work might never finish and every
 * request waiting on it would hang. There, only finished results are shared.
 */
export const shareInFlight = runtime.name !== "workers";
