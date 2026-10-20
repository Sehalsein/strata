import type { Server } from "bun";
import { dataPaths, parseArgs } from "./config";
import { createApp } from "./api/app";
import { createServices, type Services } from "./services";
import { logger, setLogDir } from "./log";
import { dashboardUrls } from "./platform/network";
import { compiledBinaryPath, RESTART_EXIT_CODE, underServiceManager } from "./platform/runtime";
import { serviceCli } from "./platform/service";
import { updateCli } from "./update/cli";
import { bootCheck, HEALTHY_AFTER_MS, markHealthy, readMarker } from "./update/marker";
import { VERSION } from "./version";

const log = logger("server");

const USAGE = `strata-server ${VERSION}

Usage:
  strata-server [serve] [--port 8420] [--host 0.0.0.0] [--data-dir PATH] [--web-dir PATH]
  strata-server service install|uninstall|status|restart   (see \`strata-server service help\`)
  strata-server update [--check] [--data-dir PATH]
  strata-server --version`;

/** Set once this process has handed over to a freshly started copy of itself (foreground mode). */
let child: ReturnType<typeof Bun.spawn> | undefined;

/**
 * Starts the (new) binary again. Under launchd/systemd we just exit with RESTART_EXIT_CODE and
 * the service manager does it. In the foreground there's nobody to do that, so this process
 * stays around as a thin supervisor: it runs the binary with the same arguments, forwards
 * signals, and relaunches it again whenever it asks for a restart.
 */
async function relaunch(): Promise<never> {
  const binary = compiledBinaryPath();
  if (underServiceManager() || !binary) process.exit(RESTART_EXIT_CODE);
  for (;;) {
    log.info(`Restarting ${binary}`);
    child = Bun.spawn([binary, ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
    const code = await child.exited;
    if (code !== RESTART_EXIT_CODE) process.exit(code ?? 0);
  }
}

async function listen(config: { host: string; port: number }, fetch: (req: Request, server: Server<undefined>) => Response | Promise<Response>): Promise<Server<undefined>> {
  // After a restart the previous process may still be releasing the port for a moment.
  for (let attempt = 1; ; attempt++) {
    try {
      // Segment requests can wait on ffmpeg; don't let Bun cut them off.
      return Bun.serve({ hostname: config.host, port: config.port, fetch, idleTimeout: 120 });
    } catch (err) {
      const inUse = (err as { code?: string }).code === "EADDRINUSE" || /in use/i.test(String(err));
      if (!inUse || attempt >= 10) throw err;
      await Bun.sleep(500);
    }
  }
}

async function serve(argv: string[]) {
  const { config } = parseArgs(argv);
  const paths = dataPaths(config.dataDir);
  setLogDir(paths.logs);

  // Before the DB is opened: undo an update that keeps failing to start.
  const boot = bootCheck(paths.root, VERSION);
  if (boot === "rolled-back") {
    log.error(`v${VERSION} failed to start after an update; restored the previous binary and database`);
    await relaunch();
  }
  if (boot === "trial") log.info(`Starting v${VERSION} after an update (attempt ${readMarker(paths.root)?.attempts})`);

  let services: Services;
  try {
    services = await createServices(config);
  } catch (err) {
    log.error("Failed to start", err);
    process.exit(1);
  }
  const app = createApp(services);
  let server: Server<undefined>;
  try {
    server = await listen(config, app.fetch);
  } catch (err) {
    log.error(`Can't listen on ${config.host}:${config.port}`, err);
    services.shutdown();
    process.exit(1);
  }

  log.info(`Strata ${VERSION} — data in ${services.paths.root}`);
  for (const url of dashboardUrls(config.host, server.port ?? config.port)) log.info(`Dashboard: ${url}`);
  if (!services.auth.hasAnyUser()) log.info("First run — open the dashboard to finish setup");
  services.bonjour.start();

  if (boot === "trial") {
    setTimeout(() => {
      if (markHealthy(paths.root, VERSION)) log.info(`Update to v${VERSION} confirmed`);
    }, HEALTHY_AFTER_MS);
  }

  let stopping = false;
  const shutdownServer = () => {
    if (stopping) return;
    stopping = true;
    server.stop(true);
    services.shutdown();
  };
  services.updater.onRestart(() => {
    shutdownServer();
    void relaunch();
  });

  const stop = (signal: NodeJS.Signals) => {
    if (child) {
      child.kill(signal);
      return;
    }
    shutdownServer();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Started by Strata.app: stop if the app goes away without stopping us (crash, force quit).
  const parent = Number(process.env.STRATA_PARENT_PID);
  if (parent > 1) {
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        log.info("Strata.app is gone; stopping");
        stop("SIGTERM");
      }
    }, 3_000).unref();
  }
}

const argv = process.argv.slice(2);
const first = argv[0];
const command = first === "--version" || first === "-v" ? "version" : first === "--help" || first === "-h" ? "help" : first && !first.startsWith("-") ? first : "serve";
const rest = command === first ? argv.slice(1) : argv;
switch (command) {
  case "serve":
    await serve(rest);
    break;
  case "version":
    console.log(VERSION);
    break;
  case "service":
    process.exit(await serviceCli(rest));
    break;
  case "update":
    process.exit(await updateCli(rest));
    break;
  case "help":
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command "${command}".\n\n${USAGE}`);
    process.exit(1);
}
