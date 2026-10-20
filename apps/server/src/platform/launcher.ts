// The secret Strata.app hands the server it starts, read once and removed from the
// environment so nothing the server spawns (ffmpeg, the updater) inherits it.
const secret = process.env.STRATA_LAUNCH_SECRET;
delete process.env.STRATA_LAUNCH_SECRET;

export function launchSecret(): string | undefined {
  return secret && secret.length >= 32 ? secret : undefined;
}
