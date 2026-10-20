import { describe, expect, test } from "bun:test";
import { DeviceLinks } from "../src/deviceLink";

describe("device links", () => {
  test("a flood of starts can't lock out a TV that is polling", () => {
    let now = 0;
    const links = new DeviceLinks(() => now);
    const tv = links.start("Living Room")!;
    for (let i = 0; i < 200; i++) {
      now += 100;
      if (i % 10 === 0) links.poll(tv.pollToken); // the real TV keeps polling
      expect(links.start("flood")).not.toBeNull();
    }
    expect(links.poll(tv.pollToken)).toEqual({ status: "pending" });
  });

  test("links nobody polls are dropped after a minute", () => {
    let now = 0;
    const links = new DeviceLinks(() => now);
    const link = links.start("TV")!;
    now += 61_000;
    expect(links.pending(link.code)).toBeNull();
    expect(links.poll(link.pollToken)).toEqual({ status: "expired" });
  });
});
