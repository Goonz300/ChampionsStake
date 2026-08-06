import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";
import { isSessionMfaVerifiedEdge } from "./session-registry-edge";

describe("isSessionMfaVerifiedEdge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // This file's own env, not vitest.config.ts's global test.env (which
    // deliberately omits it so env.test.ts can assert serverEnv throws
    // without it) -- session-registry-edge.ts reads this directly rather
    // than through serverEnv, precisely so an Edge request doesn't fail on
    // an unrelated missing secret; see its own doc comment for why.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-role-key";
  });

  it("hashes the raw token the same way session-registry.ts's hashToken does before querying", async () => {
    const { createHash } = await import("node:crypto");
    const rawToken = "the-actual-refresh-token";
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");

    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { mfa_verified_at: null } });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    vi.mocked(createServerClient).mockReturnValue({ from: fromMock } as never);

    await isSessionMfaVerifiedEdge(rawToken);

    expect(eqMock).toHaveBeenCalledWith("refresh_token_hash", expectedHash);
  });

  it("returns true when the session row has a set mfa_verified_at", async () => {
    const maybeSingleMock = vi
      .fn()
      .mockResolvedValue({ data: { mfa_verified_at: "2026-01-01T00:00:00Z" } });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    vi.mocked(createServerClient).mockReturnValue({ from: fromMock } as never);

    const result = await isSessionMfaVerifiedEdge("raw-refresh-token");

    expect(result).toBe(true);
  });

  it("returns false when mfa_verified_at is null (never completed via recovery code)", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { mfa_verified_at: null } });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    vi.mocked(createServerClient).mockReturnValue({ from: fromMock } as never);

    const result = await isSessionMfaVerifiedEdge("raw-refresh-token");

    expect(result).toBe(false);
  });

  it("returns false, not throws, when no matching session row is found", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    vi.mocked(createServerClient).mockReturnValue({ from: fromMock } as never);

    const result = await isSessionMfaVerifiedEdge("raw-refresh-token");

    expect(result).toBe(false);
  });
});
