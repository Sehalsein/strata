import { networkInterfaces } from "node:os";
import { parseArgs } from "./config";
import { createApp } from "./api/app";
import { createServices } from "./services";
import { logger } from "./log";
import { VERSION } from "./version";

const log = logger("server");

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

async function serve(argv: string[]) {
  const { config } = parseArgs(argv);
  const services = await createServices(config);
  const app = createApp(services);
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
    // Segment requests can wait on ffmpeg; don't let Bun cut them off.
    idleTimeout: 120,
  });

  log.info(`Strata ${VERSION} — data in ${services.paths.root}`);
  const hosts = config.host === "0.0.0.0" ? ["localhost", ...lanAddresses()] : [config.host];
  for (const host of hosts) log.info(`Dashboard: http://${host}:${server.port}`);
  if (!services.auth.hasAnyUser()) log.info("First run — open the dashboard to finish setup");

  const stop = () => {
    server.stop(true);
    services.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const argv = process.argv.slice(2);
const command = argv[0] === "--version" ? "version" : argv[0] && !argv[0].startsWith("-") ? argv[0] : "serve";
switch (command) {
  case "serve":
    await serve(command === argv[0] ? argv.slice(1) : argv);
    break;
  case "version":
  case "--version":
    console.log(VERSION);
    break;
  default:
    console.error(`Unknown command "${command}". Usage: strata-server [serve] [--port 8420] [--host 0.0.0.0] [--data-dir PATH]`);
    process.exit(1);
}
