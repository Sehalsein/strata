import { dataPaths, parseArgs } from "../config";
import { openDatabase } from "../db";
import { compiledBinaryPath } from "../platform/runtime";
import { restartService } from "../platform/service";
import { SecretBox } from "../secrets";
import { SettingsStore } from "../settings";
import { createUpdater } from "./index";

/**
 * `strata-server update [--check] [--data-dir PATH]`: checks the configured channel and, without
 * --check, installs the update right away (it can't see active streams from here) and restarts
 * the service if one is installed.
 */
export async function updateCli(argv: string[]): Promise<number> {
  const checkOnly = argv.includes("--check");
  const { config } = parseArgs(argv.filter((a) => a !== "--check"));
  const paths = dataPaths(config.dataDir);
  const db = openDatabase(paths.db, paths.backups);
  try {
    const settings = new SettingsStore(db, SecretBox.load(paths.secretKey));
    const updater = createUpdater({ dataDir: paths.root, dbPath: paths.db, backupsDir: paths.backups, db, settings, activeSessions: () => 0 });
    let status;
    try {
      status = await updater.check();
    } catch (err) {
      console.error(`Update check failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    console.log(`Running v${status.currentVersion} (${status.platform}), channel ${status.channel}`);
    if (!status.manifestUrl) {
      console.log(status.disabledReason);
      return 0;
    }
    if (!status.updateAvailable) {
      console.log(status.latest ? `Up to date (latest is v${status.latest.version}).` : "Up to date.");
      return 0;
    }
    console.log(`Update available: v${status.latest!.version}`);
    if (checkOnly) return 0;
    if (status.disabledReason) {
      console.error(status.disabledReason);
      return 1;
    }

    let installed = false;
    updater.onRestart(() => (installed = true));
    try {
      await updater.apply({ waitForIdle: false });
    } catch (err) {
      console.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    if (!installed) return 1;
    console.log(`Installed v${status.latest!.version}; the previous binary is kept as ${compiledBinaryPath()}.old`);
    if (restartService()) console.log("Restarted the service.");
    else console.log("Restart strata-server to run the new version.");
    return 0;
  } finally {
    db.$client.close();
  }
}
