import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: {} as {
    CAPTCHA_SECRET_KEY?: string;
    CAPTCHA_TRIGGER_AFTER_FAILURES?: string;
  },
}));

import { serverEnv } from "@/lib/env";
import { shouldRequireCaptcha, verifyCaptcha } from "./captcha";

type MutableServerEnv = {
  CAPTCHA_SECRET_KEY?: string;
  CAPTCHA_TRIGGER_AFTER_FAILURES?: string;
};

describe("shouldRequireCaptcha", () => {
  beforeEach(() => {
    delete (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY;
    delete (serverEnv as MutableServerEnv).CAPTCHA_TRIGGER_AFTER_FAILURES;
  });

  it("is never required when no provider is configured, regardless of failure count", () => {
    expect(shouldRequireCaptcha(0)).toBe(false);
    expect(shouldRequireCaptcha(100)).toBe(false);
  });

  it("is required once the failure count reaches the configured threshold", () => {
    (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY = "secret";
    (serverEnv as MutableServerEnv).CAPTCHA_TRIGGER_AFTER_FAILURES = "3";

    expect(shouldRequireCaptcha(2)).toBe(false);
    expect(shouldRequireCaptcha(3)).toBe(true);
  });

  it("uses the default threshold (3) when configured but not overridden", () => {
    (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY = "secret";

    expect(shouldRequireCaptcha(2)).toBe(false);
    expect(shouldRequireCaptcha(3)).toBe(true);
  });
});

describe("verifyCaptcha", () => {
  beforeEach(() => {
    delete (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes through true when no provider is configured", async () => {
    const result = await verifyCaptcha("some-token", "1.2.3.4");
    expect(result).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing token once a provider is configured", async () => {
    (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY = "secret";
    const result = await verifyCaptcha(undefined, "1.2.3.4");
    expect(result).toBe(false);
  });

  it("calls Turnstile's siteverify and returns its success field", async () => {
    (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY = "secret";
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ success: true }),
    } as Response);

    const result = await verifyCaptcha("valid-token", "1.2.3.4");

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns false when Turnstile reports failure", async () => {
    (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY = "secret";
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ success: false }),
    } as Response);

    const result = await verifyCaptcha("bad-token", "1.2.3.4");
    expect(result).toBe(false);
  });

  it("fails open if the verification request itself throws", async () => {
    (serverEnv as MutableServerEnv).CAPTCHA_SECRET_KEY = "secret";
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const result = await verifyCaptcha("some-token", "1.2.3.4");
    expect(result).toBe(true);
  });
});
