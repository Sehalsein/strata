import { runtime } from "#runtime";
import { MODE, type Mode } from "./mode";

/**
 * What this server does, decided once from how it was built and where it runs: the mode
 * (home or cloud, see mode.ts), the runtime (Bun or Workers), and whether it's the public
 * demo. Everything that differs between them asks here, by what it needs ("may devices
 * join without a password?"), not by mode or runtime. /api/info publishes it, so the
 * dashboard and apps don't work it out again.
 */
export interface DeploymentProfile {
  readonly mode: Mode;
  readonly runtime: "bun" | "workers";
  /** First-run setup makes the server's admin (with the setup code from its log). */
  readonly firstRunSetup: boolean;
  /** Anyone may make an account (and gets a household of their own). */
  readonly openSignUp: boolean;
  /** The server's admins are named by email (STRATA_ADMIN_EMAILS), not made at setup. */
  readonly adminsByEmail: boolean;
  /** Media folders on this machine, played through ffmpeg (remux, transcode). */
  readonly localMedia: boolean;
  /** Announces itself on the home network (Bonjour). */
  readonly bonjour: boolean;
  /** Devices on the home network may join without a password, to watch. */
  readonly homeNetworkJoin: boolean;
  /** Updates itself (the Mac app and the binaries); otherwise it's updated by deploying it. */
  readonly selfUpdate: boolean;
  /** Keeps state on this machine: the secret key in a file, the bundled database backed up daily. */
  readonly localState: boolean;
  /** Clients reach it through its host's proxy; their address comes from the proxy's headers. */
  readonly behindProxy: boolean;
  /**
   * How jobs run: in-process timers, or Cron Triggers (Workers). With several instances
   * (cloud) each job's last run is kept in the database.
   */
  readonly scheduler: "timers" | "cron";
  readonly sharedJobHistory: boolean;
  /** The public demo, once it's set up: nobody may change anything in it. */
  readOnly: boolean;
}

export function deploymentProfile(mode: Mode, runtimeName: "bun" | "workers" = runtime.name): DeploymentProfile {
  const home = mode === "home";
  return {
    mode,
    runtime: runtimeName,
    firstRunSetup: home,
    openSignUp: !home,
    adminsByEmail: !home,
    localMedia: home,
    bonjour: home,
    homeNetworkJoin: home,
    selfUpdate: home && runtimeName === "bun",
    localState: home,
    behindProxy: !home,
    scheduler: runtimeName === "workers" ? "cron" : "timers",
    sharedJobHistory: !home,
    readOnly: false,
  };
}

/** The profile this process runs with (tests pass their own to createServices). */
export const defaultProfile = (): DeploymentProfile => deploymentProfile(MODE);

/** What /api/info tells the dashboard and apps this server does. */
export function publicCapabilities(p: DeploymentProfile) {
  return {
    localMedia: p.localMedia,
    bonjour: p.bonjour,
    homeNetworkJoin: p.homeNetworkJoin,
    selfUpdate: p.selfUpdate,
    openSignUp: p.openSignUp,
    firstRunSetup: p.firstRunSetup,
    readOnly: p.readOnly,
  };
}
