import { describe, expect, it } from "vitest";
import { deriveDeviceFingerprint } from "./device";

describe("deriveDeviceFingerprint", () => {
  it("produces a stable, deterministic hash for identical inputs", () => {
    const a = deriveDeviceFingerprint("Mozilla/5.0 Test", "en-US", "203.0.113.42");
    const b = deriveDeviceFingerprint("Mozilla/5.0 Test", "en-US", "203.0.113.42");
    expect(a).toBe(b);
  });

  it("produces a different hash for a different user agent", () => {
    const a = deriveDeviceFingerprint("Mozilla/5.0 Test", "en-US", "203.0.113.42");
    const b = deriveDeviceFingerprint("Mozilla/5.0 Other", "en-US", "203.0.113.42");
    expect(a).not.toBe(b);
  });

  it("ignores the last IP octet (uses /24-ish granularity, not an exact match)", () => {
    const a = deriveDeviceFingerprint("Mozilla/5.0 Test", "en-US", "203.0.113.1");
    const b = deriveDeviceFingerprint("Mozilla/5.0 Test", "en-US", "203.0.113.254");
    expect(a).toBe(b);
  });

  it("returns a 64-character hex sha256 digest", () => {
    const hash = deriveDeviceFingerprint("Mozilla/5.0 Test", "en-US", "203.0.113.42");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
