import { describe, expect, test } from "bun:test";
import { isComplete, isResumable } from "../src/progress";

const MIN = 60_000;

describe("watch progress rules", () => {
  test("long titles complete in the credits or at 92%", () => {
    expect(isComplete(118 * MIN, 120 * MIN)).toBe(true); // 2 min left
    expect(isComplete(100 * MIN, 120 * MIN)).toBe(false);
    expect(isComplete(111 * MIN, 120 * MIN)).toBe(true); // 92.5%
  });

  test("short titles aren't watched just because under 3 minutes remain", () => {
    expect(isComplete(3_000, 30_000)).toBe(false);
    expect(isComplete(2 * MIN, 10 * MIN)).toBe(false);
    expect(isComplete(28_000, 30_000)).toBe(true);
  });

  test("resumable after a minute, or 5% of a short title, never under 5s", () => {
    expect(isResumable({ positionMs: 61_000, durationMs: 120 * MIN, completed: false })).toBe(true);
    expect(isResumable({ positionMs: 30_000, durationMs: 120 * MIN, completed: false })).toBe(false);
    expect(isResumable({ positionMs: 40_000, durationMs: 10 * MIN, completed: false })).toBe(true);
    expect(isResumable({ positionMs: 3_000, durationMs: 30_000, completed: false })).toBe(false);
    expect(isResumable({ positionMs: 90_000, durationMs: 120 * MIN, completed: true })).toBe(false);
  });
});
