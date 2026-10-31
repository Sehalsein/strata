import { describe, expect, test } from "bun:test";
import { deviceChanges, isPrivateMac, type DeviceInfo } from "../src/api/deviceInfo";

describe("devices", () => {
  test("a made-up (locally administered) MAC is a private Wi-Fi address", () => {
    expect(isPrivateMac("a2:11:22:33:44:55")).toBe(true);
    expect(isPrivateMac("de:11:22:33:44:55")).toBe(true);
    expect(isPrivateMac("3c:22:fb:00:11:22")).toBe(false);
  });

  test("a session changes only when something about its device did", () => {
    const now: DeviceInfo = { ipAddress: "10.0.0.2", location: "Home network", deviceName: null, deviceModel: null, userAgent: "Safari" };
    expect(deviceChanges({ ipAddress: "10.0.0.2", location: "Home network", userAgent: "Safari" }, now)).toBeNull();
    // A browser sends no device name: the app's earlier one stays.
    expect(deviceChanges({ ipAddress: "10.0.0.2", location: "Home network", userAgent: "Safari", deviceName: "Sam's iPad" }, now)).toBeNull();
    expect(deviceChanges({ ipAddress: "10.0.0.9", location: "Home network", userAgent: "Safari" }, now)).toEqual({ ipAddress: "10.0.0.2", location: "Home network" });
  });
});
