import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("info/debug emit via console.log as a single JSON line", () => {
    logger.info("something happened");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("something happened");
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("warn emits via console.warn", () => {
    logger.warn("careful");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("error emits via console.error", () => {
    logger.error("broken");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("merges the passed context object into the JSON line", () => {
    logger.error("wallet fetch failed", { userId: "u1", route: "/dashboard" });
    const parsed = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(parsed.userId).toBe("u1");
    expect(parsed.route).toBe("/dashboard");
  });

  it("two calls in sequence never leak context between them (no shared mutable state)", () => {
    logger.error("first", { userId: "u1" });
    logger.error("second");
    const first = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    const second = JSON.parse(errorSpy.mock.calls[1]![0] as string);
    expect(first.userId).toBe("u1");
    expect(second.userId).toBeUndefined();
  });
});
