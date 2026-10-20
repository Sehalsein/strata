import { platform } from "node:os";
import type { Subprocess } from "bun";

/** Prevents idle system sleep while held. Only macOS needs (and supports) this. */
export class KeepAwake {
  private proc?: Subprocess;
  private holders = 0;

  acquire() {
    this.holders++;
    if (this.holders === 1 && platform() === "darwin" && Bun.which("caffeinate")) {
      // -w ties caffeinate's life to ours, so a crash never leaves the Mac awake forever.
      this.proc = Bun.spawn(["caffeinate", "-i", "-w", String(process.pid)], { stdout: "ignore", stderr: "ignore" });
    }
  }

  release() {
    this.holders = Math.max(0, this.holders - 1);
    if (this.holders === 0 && this.proc) {
      this.proc.kill();
      this.proc = undefined;
    }
  }
}
