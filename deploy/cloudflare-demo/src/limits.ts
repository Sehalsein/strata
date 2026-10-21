/**
 * Every limit on the public demo, in one place. Anything over a limit is refused by the
 * Worker before the container is woken, so it costs (next to) nothing.
 *
 * Sizes: a demo clip is 3 minutes and ~10–25 MB.
 */
export const LIMITS = {
  /** The container sleeps (and stops billing) after this long without a request. */
  sleepAfter: "5m",
  /** Largest request body accepted (sign-in, progress…); uploads aren't a thing here. */
  maxBodyBytes: 2_048,
  /** What a stream request reserves when it doesn't say how much it wants (a whole clip). */
  maxClipBytes: 32 * 1024 * 1024,

  /** Per visitor (by IP address). */
  perVisitor: {
    requestsPerMinute: 30,
    signInsPerHour: 5,
    playsPerHour: 4,
    /** Video requests open at once (the player fetches a few ranges in parallel). */
    streamsInFlight: 3,
    /** About five clips a day. */
    bytesPerDay: 120 * 1024 * 1024,
  },

  /** The whole demo, all visitors together. */
  global: {
    requestsPerMinute: 240,
    signInsPerHour: 60,
    playsPerDay: 150,
    /** People watching at the same moment (a play in the last 3 minutes). */
    concurrentViewers: 3,
    bytesPerDay: 3 * 1024 * 1024 * 1024,
    bytesPerMonth: 40 * 1024 * 1024 * 1024,
  },
} as const;
