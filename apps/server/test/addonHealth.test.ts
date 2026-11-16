import { describe, expect, test } from "bun:test";
import { AddonHealth, AddonPausedError, describeAddonError } from "../src/sources/addonHealth";

describe("add-on health", () => {
  test("unknown until asked; ok with how long it took; failing with what went wrong", async () => {
    let now = 1_000;
    const h = new AddonHealth(() => now);
    expect(h.view("a")).toEqual({ state: "unknown" });
    await h.track("a", "A", async () => {
      now += 250;
      return 1;
    });
    expect(h.view("a")).toEqual({ state: "ok", at: 1_250, latencyMs: 250 });
    await expect(h.track("a", "A", async () => Promise.reject(new Error("A 503")))).rejects.toThrow();
    expect(h.view("a")).toMatchObject({ state: "failing", message: "Had a problem on its side (503)." });
  });

  test("three failures in a row pause it for a while; then it's asked again", async () => {
    let now = 0;
    const h = new AddonHealth(() => now);
    let asked = 0;
    const fail = () => h.track("a", "A", async () => (asked++, Promise.reject(new Error("timed out"))));
    for (let i = 0; i < 3; i++) await expect(fail()).rejects.toThrow("timed out");
    expect(h.view("a")).toMatchObject({ state: "paused", message: "Didn't answer in time.", pausedUntil: 5 * 60_000 });
    await expect(fail()).rejects.toBeInstanceOf(AddonPausedError);
    expect(asked).toBe(3);
    now = 5 * 60_000 + 1;
    await h.track("a", "A", async () => "back");
    expect(h.view("a").state).toBe("ok");
  });

  test("failures are told in words, never with the add-on's address", () => {
    expect(describeAddonError(new Error("Comet | ElfHosted 403"))).toContain("Turned Strata away (403)");
    expect(describeAddonError(new Error("getaddrinfo ENOTFOUND https://x.example/SECRET/manifest.json"))).toBe("Its address couldn't be found.");
    expect(describeAddonError(new SyntaxError("Unexpected token < in JSON"))).toContain("isn't an add-on's answer");
    expect(describeAddonError(new Error("weird"))).toBe("Failed to answer.");
  });
});
