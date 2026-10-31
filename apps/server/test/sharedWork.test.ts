import { expect, test } from "bun:test";
import { SharedWork } from "../src/inFlight";

const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 5));

test("on Bun, callers join work in progress and, with remember, its result", async () => {
  const work = new SharedWork<string, number>({ remember: true, shareInFlight: true });
  let calls = 0;
  const run = () => work.get("a", () => (calls++, later(1)));
  expect(await Promise.all([run(), run()])).toEqual([1, 1]);
  expect(await run()).toBe(1);
  expect(calls).toBe(1);
});

test("on Workers, nobody waits on another caller's work; only a finished result is shared", async () => {
  const work = new SharedWork<string, number>({ remember: true, shareInFlight: false });
  let calls = 0;
  const run = () => work.get("a", () => (calls++, later(1)));
  await Promise.all([run(), run()]);
  expect(calls).toBe(2);
  expect(work.running("a")).toBe(false);
  await run();
  expect(calls).toBe(2);
});

test("a failure isn't kept, so the next caller tries again", async () => {
  const work = new SharedWork<string, number>({ remember: true, shareInFlight: true });
  await expect(work.get("a", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  expect(await work.get("a", () => later(2))).toBe(2);
});

test("without remember, only work in progress is shared; past max the oldest goes, past ttl it's redone", async () => {
  const shared = new SharedWork<string, number>({ shareInFlight: true });
  let calls = 0;
  await shared.get("a", () => (calls++, later(1)));
  await shared.get("a", () => (calls++, later(1)));
  expect(calls).toBe(2);
  const bounded = new SharedWork<number, number>({ remember: true, max: 2, shareInFlight: true });
  for (const k of [1, 2, 3]) await bounded.get(k, () => later(k));
  expect(bounded.size).toBe(2);
  let redone = 0;
  await bounded.get(1, () => (redone++, later(1)));
  expect(redone).toBe(1);
  const expiring = new SharedWork<string, number>({ remember: true, ttlMs: 10, shareInFlight: true });
  await expiring.get("a", () => later(1));
  await Bun.sleep(15);
  expect(await expiring.get("a", () => later(2))).toBe(2);
});
