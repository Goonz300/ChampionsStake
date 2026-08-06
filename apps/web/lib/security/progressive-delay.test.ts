import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: {} as { PROGRESSIVE_DELAY_STEPS_SECONDS?: string },
}));

import { serverEnv } from "@/lib/env";
import { delay, getProgressiveDelayMs } from "./progressive-delay";

describe("getProgressiveDelayMs", () => {
  beforeEach(() => {
    delete (serverEnv as { PROGRESSIVE_DELAY_STEPS_SECONDS?: string })
      .PROGRESSIVE_DELAY_STEPS_SECONDS;
  });

  it("uses the default step progression (0, 2, 5, 15, 30 seconds) when unconfigured", () => {
    expect(getProgressiveDelayMs(0)).toBe(0);
    expect(getProgressiveDelayMs(1)).toBe(2000);
    expect(getProgressiveDelayMs(2)).toBe(5000);
    expect(getProgressiveDelayMs(3)).toBe(15000);
    expect(getProgressiveDelayMs(4)).toBe(30000);
  });

  it("clamps to the last step once the failure count exceeds the configured steps", () => {
    expect(getProgressiveDelayMs(100)).toBe(30000);
  });

  it("reads a custom step progression from PROGRESSIVE_DELAY_STEPS_SECONDS", () => {
    (serverEnv as { PROGRESSIVE_DELAY_STEPS_SECONDS?: string }).PROGRESSIVE_DELAY_STEPS_SECONDS =
      "0,1,3";
    expect(getProgressiveDelayMs(0)).toBe(0);
    expect(getProgressiveDelayMs(1)).toBe(1000);
    expect(getProgressiveDelayMs(2)).toBe(3000);
    expect(getProgressiveDelayMs(5)).toBe(3000);
  });

  it("falls back to the default progression if the configured value is unparseable", () => {
    (serverEnv as { PROGRESSIVE_DELAY_STEPS_SECONDS?: string }).PROGRESSIVE_DELAY_STEPS_SECONDS =
      "not,a,number";
    expect(getProgressiveDelayMs(1)).toBe(2000);
  });

  it("never returns a negative delay", () => {
    expect(getProgressiveDelayMs(-5)).toBe(0);
  });
});

describe("delay", () => {
  it("resolves immediately for zero or negative durations", async () => {
    const start = Date.now();
    await delay(0);
    await delay(-10);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("waits at least the requested duration", async () => {
    const start = Date.now();
    await delay(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
