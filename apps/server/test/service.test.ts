import { describe, expect, test } from "bun:test";
import { advertiseCommand } from "../src/platform/bonjour";
import { launchdPlist, serveArgs, systemdQuote, systemdUnit } from "../src/platform/service";

const spec = {
  binary: "/Users/me/.local/bin/strata-server",
  args: serveArgs({ dataDir: "/Users/me/Library/Application Support/Strata", port: 8420, host: "0.0.0.0" }),
  logDir: "/Users/me/Library/Application Support/Strata/logs",
  workingDir: "/Users/me/Library/Application Support/Strata",
};

describe("launchd plist", () => {
  const plist = launchdPlist(spec);

  test("runs the stable binary with the install-time arguments", () => {
    expect(plist).toContain("<string>com.strata.server</string>");
    expect(plist).toContain(
      [
        "<string>/Users/me/.local/bin/strata-server</string>",
        "<string>serve</string>",
        "<string>--data-dir</string>",
        "<string>/Users/me/Library/Application Support/Strata</string>",
        "<string>--port</string>",
        "<string>8420</string>",
        "<string>--host</string>",
        "<string>0.0.0.0</string>",
      ].join("\n    "),
    );
  });

  test("starts at load, restarts, logs into the data dir and marks itself as a service", () => {
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(plist).toContain("<string>/Users/me/Library/Application Support/Strata/logs/service.out.log</string>");
    expect(plist).toContain("<string>/Users/me/Library/Application Support/Strata/logs/service.err.log</string>");
    expect(plist).toMatch(/<key>STRATA_SERVICE<\/key>\s*<string>1<\/string>/);
  });

  test("escapes XML", () => {
    expect(launchdPlist({ ...spec, args: ["serve", "--data-dir", "/tmp/a&b<c>"] })).toContain("<string>/tmp/a&amp;b&lt;c&gt;</string>");
  });
});

describe("systemd unit", () => {
  test("user unit", () => {
    const unit = systemdUnit({ ...spec, binary: "/home/me/.local/bin/strata-server", args: serveArgs({ dataDir: "/home/me/.local/share/strata", port: 9000, host: "127.0.0.1" }), system: false });
    expect(unit).toContain("ExecStart=/home/me/.local/bin/strata-server serve --data-dir /home/me/.local/share/strata --port 9000 --host 127.0.0.1\n");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("Environment=STRATA_SERVICE=1");
    expect(unit).toContain("WantedBy=default.target");
    expect(unit).not.toContain("User=");
  });

  test("system unit runs as the given user", () => {
    const unit = systemdUnit({ ...spec, system: true, user: "media" });
    expect(unit).toContain("User=media");
    expect(unit).toContain("WantedBy=multi-user.target");
    expect(unit).toContain('--data-dir "/Users/me/Library/Application Support/Strata"');
  });

  test("quotes arguments", () => {
    expect(systemdQuote("/plain/path")).toBe("/plain/path");
    expect(systemdQuote("with space")).toBe('"with space"');
    expect(systemdQuote('q"uote')).toBe('"q\\"uote"');
    expect(systemdQuote("100%")).toBe("100%%");
  });
});

describe("bonjour command", () => {
  const advert = { name: "Living Room", port: 8420, txt: { version: "0.2.0", api: "1", id: "abc" } };

  test("macOS uses dns-sd -R", () => {
    expect(advertiseCommand(advert, "darwin", () => "/usr/bin/dns-sd")).toEqual(["/usr/bin/dns-sd", "-R", "Living Room", "_strata._tcp", "local", "8420", "version=0.2.0", "api=1", "id=abc"]);
  });

  test("Linux uses avahi-publish-service", () => {
    const which = (bin: string) => (bin === "avahi-publish-service" ? "/usr/bin/avahi-publish-service" : null);
    expect(advertiseCommand(advert, "linux", which)).toEqual(["/usr/bin/avahi-publish-service", "Living Room", "_strata._tcp", "8420", "version=0.2.0", "api=1", "id=abc"]);
  });

  test("no tool means no advert", () => {
    expect(advertiseCommand(advert, "linux", () => null)).toBeNull();
    expect(advertiseCommand(advert, "win32", () => "x")).toBeNull();
  });
});
