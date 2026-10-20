import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { dataPaths, parseArgs, type RuntimeConfig } from "../config";
import { dashboardUrls } from "./network";
import { compiledBinaryPath } from "./runtime";

/**
 * `strata-server service install|uninstall|status|restart`: registers the server with launchd
 * (macOS, per-user LaunchAgent) or systemd (Linux, user unit by default, `--system` for a
 * system unit). The service always runs a copy of the binary at a stable, user-writable path
 * so self-update can replace it in place.
 */

export const LAUNCHD_LABEL = "com.strata.server";
export const SYSTEMD_UNIT = "strata-server.service";
/** Binary location for the system unit; owned by the service user so self-update works. */
export const SYSTEM_BINARY = "/usr/local/lib/strata/strata-server";
export const SYSTEM_DATA_DIR = "/var/lib/strata";
const SERVICE_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export interface ServiceSpec {
  binary: string;
  /** Arguments after the binary, e.g. ["serve", "--data-dir", …]. */
  args: string[];
  logDir: string;
  workingDir: string;
}

export const userBinaryPath = (home = homedir()) => join(home, ".local", "bin", "strata-server");
export const launchAgentPath = (home = homedir()) => join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
export const userUnitPath = (home = homedir()) => join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "systemd", "user", SYSTEMD_UNIT);
export const systemUnitPath = () => join("/etc/systemd/system", SYSTEMD_UNIT);

/** Arguments the service passes to `serve`, pinned to what install saw. */
export function serveArgs(config: Pick<RuntimeConfig, "dataDir" | "port" | "host">): string[] {
  return ["serve", "--data-dir", config.dataDir, "--port", String(config.port), "--host", config.host];
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchdPlist(spec: ServiceSpec): string {
  const args = [spec.binary, ...spec.args].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>STRATA_SERVICE</key>
    <string>1</string>
    <key>PATH</key>
    <string>${SERVICE_PATH}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(spec.workingDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(join(spec.logDir, "service.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(spec.logDir, "service.err.log"))}</string>
</dict>
</plist>
`;
}

/** Quotes one ExecStart argument per systemd's rules (and escapes `%` specifiers). */
export function systemdQuote(arg: string): string {
  const escaped = arg.replace(/%/g, "%%");
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(escaped) ? escaped : `"${escaped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function systemdUnit(spec: ServiceSpec & { system: boolean; user?: string }): string {
  const exec = [spec.binary, ...spec.args].map(systemdQuote).join(" ");
  return `[Unit]
Description=Strata media server
Documentation=https://github.com/Sehalsein/strata/tree/main/apps/server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
WorkingDirectory=${systemdQuote(spec.workingDir)}
Environment=STRATA_SERVICE=1
${spec.system && spec.user ? `User=${spec.user}\n` : ""}Restart=always
RestartSec=3
# Self-update exits with 75 after swapping the binary; Restart=always starts the new one
# (75 is listed as a clean exit so it is not logged as a failure).
SuccessExitStatus=75

[Install]
WantedBy=${spec.system ? "multi-user.target" : "default.target"}
`;
}

// --- CLI ---------------------------------------------------------------------------------

interface ExecResult {
  code: number;
  out: string;
}

function exec(cmd: string[]): ExecResult {
  try {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? 1, out: (r.stdout.toString() + r.stderr.toString()).trim() };
  } catch (err) {
    return { code: 127, out: err instanceof Error ? err.message : String(err) };
  }
}

function must(cmd: string[]) {
  const r = exec(cmd);
  if (r.code !== 0) throw new Error(`${cmd.join(" ")} failed (${r.code})${r.out ? `: ${r.out}` : ""}`);
  return r.out;
}

/** Copies via a temp file + rename, so a running copy at `to` is never overwritten in place. */
function installBinaryAt(from: string, to: string) {
  if (from === to) return false;
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.installing`;
  copyFileSync(from, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, to);
  return true;
}

const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;
const uid = () => (typeof process.getuid === "function" ? process.getuid() : 0);

interface InstallOptions {
  system: boolean;
  /** Print what would be written, change nothing. */
  dryRun: boolean;
  user?: string;
  config: RuntimeConfig;
  /** --data-dir/STRATA_DATA_DIR was given explicitly. */
  dataDirGiven: boolean;
}

function parseServiceArgs(argv: string[]): InstallOptions {
  const rest: string[] = [];
  let system = false;
  let dryRun = false;
  let user: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--system") system = true;
    else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--user") user = argv[++i];
    else rest.push(argv[i]!);
  }
  const { config } = parseArgs(rest);
  return { system, dryRun, user, config, dataDirGiven: rest.includes("--data-dir") || !!process.env.STRATA_DATA_DIR };
}

function printNextSteps(config: RuntimeConfig, extra: string[]) {
  console.log("\nStrata is installed as a service and starts at login/boot.");
  console.log("Open the dashboard:");
  for (const url of dashboardUrls(config.host, config.port)) console.log(`  ${url}`);
  for (const line of extra) console.log(line);
}

function installMac(opts: InstallOptions, binary: string) {
  const target = userBinaryPath();
  if (installBinaryAt(binary, target)) console.log(`Copied the binary to ${target}`);
  const paths = dataPaths(opts.config.dataDir);
  const plist = launchAgentPath();
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, launchdPlist({ binary: target, args: serveArgs(opts.config), logDir: paths.logs, workingDir: paths.root }));
  console.log(`Wrote ${plist}`);
  const domain = `gui/${uid()}`;
  exec(["launchctl", "bootout", `${domain}/${LAUNCHD_LABEL}`]); // fine if it wasn't loaded
  must(["launchctl", "bootstrap", domain, plist]);
  printNextSteps(opts.config, [
    "",
    `Logs:      ${paths.logs}/strata.log`,
    `Status:    ${target} service status`,
    `Uninstall: ${target} service uninstall`,
  ]);
}

function installLinuxUser(opts: InstallOptions, binary: string) {
  const target = userBinaryPath();
  if (installBinaryAt(binary, target)) console.log(`Copied the binary to ${target}`);
  const paths = dataPaths(opts.config.dataDir);
  const unit = userUnitPath();
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, systemdUnit({ binary: target, args: serveArgs(opts.config), logDir: paths.logs, workingDir: paths.root, system: false }));
  console.log(`Wrote ${unit}`);
  must(["systemctl", "--user", "daemon-reload"]);
  must(["systemctl", "--user", "enable", "--now", SYSTEMD_UNIT]);
  printNextSteps(opts.config, [
    "",
    "User services stop when you log out. To keep Strata running without a login session:",
    `  sudo loginctl enable-linger ${userInfo().username}`,
    "",
    `Logs:      journalctl --user -u strata-server -f   (also ${paths.logs}/strata.log)`,
    `Status:    ${target} service status`,
    `Uninstall: ${target} service uninstall`,
  ]);
}

function installLinuxSystem(opts: InstallOptions, binary: string, argv: string[]) {
  if (!isRoot()) {
    console.log("A system service needs root. Run:\n");
    console.log(`  sudo ${[binary, "service", "install", ...argv].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}\n`);
    console.log("Or install a per-user service without root: strata-server service install");
    return 1;
  }
  const user = opts.user ?? process.env.SUDO_USER;
  if (!user || user === "root") throw new Error("Pass --user <name>: the system service should not run as root");
  const ids = { uid: must(["id", "-u", user]), gid: must(["id", "-g", user]) };
  const config = { ...opts.config, dataDir: opts.dataDirGiven ? opts.config.dataDir : SYSTEM_DATA_DIR };
  if (installBinaryAt(binary, SYSTEM_BINARY)) console.log(`Copied the binary to ${SYSTEM_BINARY}`);
  const paths = dataPaths(config.dataDir);
  // The service user owns its binary directory (for self-update) and its data.
  must(["chown", "-R", `${ids.uid}:${ids.gid}`, dirname(SYSTEM_BINARY), paths.root]);
  writeFileSync(systemUnitPath(), systemdUnit({ binary: SYSTEM_BINARY, args: serveArgs(config), logDir: paths.logs, workingDir: paths.root, system: true, user }));
  console.log(`Wrote ${systemUnitPath()} (runs as ${user})`);
  must(["systemctl", "daemon-reload"]);
  must(["systemctl", "enable", "--now", SYSTEMD_UNIT]);
  printNextSteps(config, ["", "Logs:      journalctl -u strata-server -f", `Uninstall: sudo ${SYSTEM_BINARY} service uninstall --system`]);
  return 0;
}

function dryRun(opts: InstallOptions) {
  const system = opts.system && process.platform === "linux";
  const config = system && !opts.dataDirGiven ? { ...opts.config, dataDir: SYSTEM_DATA_DIR } : opts.config;
  const binary = system ? SYSTEM_BINARY : userBinaryPath();
  const spec = { binary, args: serveArgs(config), logDir: join(config.dataDir, "logs"), workingDir: config.dataDir };
  const file = process.platform === "darwin" ? launchAgentPath() : system ? systemUnitPath() : userUnitPath();
  console.log(`Would copy the binary to ${binary} and write ${file}:\n`);
  console.log(process.platform === "darwin" ? launchdPlist(spec) : systemdUnit({ ...spec, system, user: opts.user ?? process.env.SUDO_USER }));
}

type Installed = { kind: "launchd" | "systemd-user" | "systemd-system"; file: string } | null;

export function installedService(): Installed {
  if (process.platform === "darwin") return existsSync(launchAgentPath()) ? { kind: "launchd", file: launchAgentPath() } : null;
  if (process.platform === "linux") {
    if (existsSync(userUnitPath())) return { kind: "systemd-user", file: userUnitPath() };
    if (existsSync(systemUnitPath())) return { kind: "systemd-system", file: systemUnitPath() };
  }
  return null;
}

/** Restarts the installed service. Returns false when there is none (or it can't be restarted from here). */
export function restartService(): boolean {
  const svc = installedService();
  if (!svc) return false;
  if (svc.kind === "launchd") return exec(["launchctl", "kickstart", "-k", `gui/${uid()}/${LAUNCHD_LABEL}`]).code === 0;
  if (svc.kind === "systemd-user") return exec(["systemctl", "--user", "restart", SYSTEMD_UNIT]).code === 0;
  return isRoot() && exec(["systemctl", "restart", SYSTEMD_UNIT]).code === 0;
}

function status(): number {
  const svc = installedService();
  if (!svc) {
    console.log("Strata is not installed as a service.");
    console.log("Install it with: strata-server service install [--port 8420] [--data-dir PATH]");
    return 3;
  }
  console.log(`Service: ${svc.kind} (${svc.file})`);
  const contents = readFileSync(svc.file, "utf8");
  if (svc.kind === "launchd") {
    const r = exec(["launchctl", "print", `gui/${uid()}/${LAUNCHD_LABEL}`]);
    if (r.code !== 0) {
      console.log("State:   not loaded (run `strata-server service install` again to load it)");
    } else {
      const state = /^\s*state = (.+)$/m.exec(r.out)?.[1] ?? "unknown";
      const pid = /^\s*pid = (\d+)$/m.exec(r.out)?.[1];
      const lastExit = /^\s*last exit code = (.+)$/m.exec(r.out)?.[1];
      console.log(`State:   ${state}${pid ? ` (pid ${pid})` : ""}${lastExit && state !== "running" ? `, last exit ${lastExit}` : ""}`);
    }
    const binary = /<array>\s*<string>([^<]+)<\/string>/.exec(contents)?.[1];
    if (binary) reportBinary(binary);
    reportPort(/<string>--port<\/string>\s*<string>(\d+)<\/string>/.exec(contents)?.[1], /<string>--host<\/string>\s*<string>([^<]+)<\/string>/.exec(contents)?.[1]);
  } else {
    const scope = svc.kind === "systemd-user" ? ["--user"] : [];
    const active = exec(["systemctl", ...scope, "is-active", SYSTEMD_UNIT]).out || "unknown";
    const pid = exec(["systemctl", ...scope, "show", "-p", "MainPID", "--value", SYSTEMD_UNIT]).out;
    console.log(`State:   ${active}${pid && pid !== "0" ? ` (pid ${pid})` : ""}`);
    const execLine = /^ExecStart=(\S+)/m.exec(contents)?.[1];
    if (execLine) reportBinary(execLine.replace(/^"|"$/g, ""));
    reportPort(/--port (\d+)/.exec(contents)?.[1], /--host (\S+)/.exec(contents)?.[1]);
  }
  return 0;
}

function reportBinary(binary: string) {
  const v = existsSync(binary) ? exec([binary, "--version"]) : { code: 1, out: "missing" };
  console.log(`Binary:  ${binary} (${v.code === 0 ? `v${v.out}` : v.out})`);
}

function reportPort(port?: string, host?: string) {
  if (!port) return;
  console.log(`URL:     ${dashboardUrls(host ?? "0.0.0.0", Number(port))[0]}`);
}

function uninstall(system: boolean): number {
  const svc = installedService();
  if (!svc) {
    console.log("No Strata service is installed.");
    return 0;
  }
  if (svc.kind === "launchd") {
    exec(["launchctl", "bootout", `gui/${uid()}/${LAUNCHD_LABEL}`]);
    rmSync(svc.file, { force: true });
  } else if (svc.kind === "systemd-user") {
    exec(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT]);
    rmSync(svc.file, { force: true });
    exec(["systemctl", "--user", "daemon-reload"]);
  } else {
    if (!isRoot()) {
      console.log(`Removing the system service needs root. Run:\n\n  sudo ${process.execPath} service uninstall${system ? " --system" : ""}\n`);
      return 1;
    }
    exec(["systemctl", "disable", "--now", SYSTEMD_UNIT]);
    rmSync(svc.file, { force: true });
    exec(["systemctl", "daemon-reload"]);
  }
  console.log(`Removed ${svc.file}. Strata no longer starts automatically.`);
  console.log("Your data directory and the installed binary were left in place; delete them by hand if you want them gone.");
  return 0;
}

const USAGE = `Usage:
  strata-server service install [--port 8420] [--host 0.0.0.0] [--data-dir PATH] [--system [--user NAME]] [--dry-run]
  strata-server service uninstall [--system]
  strata-server service status
  strata-server service restart`;

export async function serviceCli(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (process.platform !== "darwin" && process.platform !== "linux") {
    console.error(`Service install isn't supported on ${process.platform}.`);
    return 1;
  }
  switch (sub) {
    case "install": {
      const opts = parseServiceArgs(rest);
      if (opts.dryRun) {
        dryRun(opts);
        return 0;
      }
      const binary = compiledBinaryPath();
      if (!binary) {
        console.error("`service install` must be run from the compiled strata-server binary (bun run build), not from source.");
        return 1;
      }
      if (process.platform === "darwin") {
        if (opts.system) console.log("--system is Linux-only; installing a per-user LaunchAgent.");
        installMac(opts, binary);
        return 0;
      }
      if (opts.system) return installLinuxSystem(opts, binary, rest);
      installLinuxUser(opts, binary);
      return 0;
    }
    case "uninstall":
      return uninstall(rest.includes("--system"));
    case "status":
      return status();
    case "restart":
      if (restartService()) {
        console.log("Restarted.");
        return 0;
      }
      console.error("Couldn't restart: no service installed (or a system service without root).");
      return 1;
    default:
      console.error(USAGE);
      return sub === undefined || sub === "help" || sub === "--help" ? 0 : 1;
  }
}
