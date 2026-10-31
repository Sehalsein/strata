import { beforeAll, describe, expect, test } from "bun:test";
import { DeviceLinks } from "../src/deviceLink";
import { openDatabase, type Db } from "../src/db";
import { SecretBox } from "../src/secrets";

const box = SecretBox.fromBase64(Buffer.alloc(32, 7).toString("base64"), "test");
let db: Db;
beforeAll(async () => {
  db = await openDatabase("memory");
});

describe("device links", () => {
  test("a flood of starts can't lock out a TV that is polling", async () => {
    let now = 0;
    const links = new DeviceLinks(db, box, () => now);
    const tv = (await links.start("Living Room"))!;
    for (let i = 0; i < 200; i++) {
      now += 100;
      if (i % 10 === 0) await links.poll(tv.pollToken); // the real TV keeps polling
      expect(await links.start("flood")).not.toBeNull();
    }
    expect(await links.poll(tv.pollToken)).toEqual({ status: "pending" });
  });

  test("links nobody polls are dropped after a minute", async () => {
    let now = 10_000_000;
    const links = new DeviceLinks(db, box, () => now);
    const link = (await links.start("TV"))!;
    now += 61_000;
    expect(await links.pending(link.code)).toBeNull();
    expect(await links.poll(link.pollToken)).toEqual({ status: "expired" });
  });

  test("an approved code hands the TV its token once, and only to the TV", async () => {
    let now = 20_000_000;
    const links = new DeviceLinks(db, box, () => now);
    const link = (await links.start("Bedroom"))!;
    expect(await links.approve(link.code.toLowerCase(), async () => "the-token")).toBe(true);
    expect(await links.approve(link.code, async () => "second")).toBe(false);
    expect(await links.poll("wrong-poll-token")).toEqual({ status: "expired" });
    expect(await links.poll(link.pollToken)).toEqual({ status: "approved", token: "the-token" });
    expect(await links.poll(link.pollToken)).toEqual({ status: "expired" });
  });
});
