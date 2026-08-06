import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/server";
import { isLoginRateLimited, isMfaVerifyRateLimited } from "./rate-limit";

describe("isLoginRateLimited", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false (not rate limited) when under the attempt threshold", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            contains: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      }),
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await isLoginRateLimited("player@example.com", "1.2.3.4");
    expect(result).toBe(false);
  });

  it("returns true (rate limited) at or above the attempt threshold", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            contains: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      }),
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await isLoginRateLimited("player@example.com", "1.2.3.4");
    expect(result).toBe(true);
  });

  it("fails open (allows the attempt) if the rate-limit check itself errors", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            contains: vi.fn().mockResolvedValue({ count: null, error: new Error("db down") }),
          }),
        }),
      }),
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await isLoginRateLimited("player@example.com", "1.2.3.4");
    // Documented tradeoff: a broken monitoring query should not itself take
    // down the login flow. See the comment in rate-limit.ts.
    expect(result).toBe(false);
  });
});

describe("isMfaVerifyRateLimited", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false (not rate limited) when under the attempt threshold", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            contains: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      }),
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await isMfaVerifyRateLimited("factor-1");
    expect(result).toBe(false);
  });

  it("returns true (rate limited) at or above the attempt threshold", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            contains: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      }),
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await isMfaVerifyRateLimited("factor-1");
    expect(result).toBe(true);
  });

  it("fails CLOSED (blocks the attempt) if the rate-limit check itself errors -- the opposite direction from login", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            contains: vi.fn().mockResolvedValue({ count: null, error: new Error("db down") }),
          }),
        }),
      }),
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await isMfaVerifyRateLimited("factor-1");
    // Deliberately the opposite of isLoginRateLimited's fail-open: MFA
    // verification is the last line of defense against account takeover,
    // so a broken monitoring query must not remove brute-force resistance
    // on a 6-digit code. See the comment in rate-limit.ts.
    expect(result).toBe(true);
  });
});
