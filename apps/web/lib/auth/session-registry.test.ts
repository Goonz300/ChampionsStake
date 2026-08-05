import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  invalidateAllSessionsForUser,
  recordSession,
  revokeAllSessionsForUser,
  revokeSessionByToken,
} from "./session-registry";

describe("recordSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a hashed (never raw) refresh token into user_sessions", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockFrom = vi.fn().mockReturnValue({ insert: insertMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const expiresAt = new Date("2026-01-01T00:00:00Z");
    await recordSession("user-1", "raw-refresh-token", "1.2.3.4", "TestAgent/1.0", expiresAt);

    expect(mockFrom).toHaveBeenCalledWith("user_sessions");
    const insertedRow = insertMock.mock.calls[0]![0];
    expect(insertedRow.user_id).toBe("user-1");
    expect(insertedRow.refresh_token_hash).not.toBe("raw-refresh-token");
    expect(insertedRow.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(insertedRow.ip_address).toBe("1.2.3.4");
    expect(insertedRow.user_agent).toBe("TestAgent/1.0");
    expect(insertedRow.expires_at).toBe(expiresAt.toISOString());
  });
});

describe("revokeSessionByToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes only the row matching the token's hash and not already revoked", async () => {
    const isMock = vi.fn().mockResolvedValue({ error: null });
    const eqMock = vi.fn().mockReturnValue({ is: isMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    await revokeSessionByToken("raw-refresh-token");

    expect(mockFrom).toHaveBeenCalledWith("user_sessions");
    const updatePayload = updateMock.mock.calls[0]![0];
    expect(updatePayload.revoked_at).toBeTruthy();
    expect(eqMock).toHaveBeenCalledWith(
      "refresh_token_hash",
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(isMock).toHaveBeenCalledWith("revoked_at", null);
  });
});

describe("revokeAllSessionsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes every not-yet-revoked row for the given user", async () => {
    const isMock = vi.fn().mockResolvedValue({ error: null });
    const eqMock = vi.fn().mockReturnValue({ is: isMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    await revokeAllSessionsForUser("user-1");

    expect(mockFrom).toHaveBeenCalledWith("user_sessions");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(isMock).toHaveBeenCalledWith("revoked_at", null);
  });
});

describe("invalidateAllSessionsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets profiles.sessions_invalidated_at scoped to exactly one user's row, and returns no error on success", async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const before = Date.now();
    const result = await invalidateAllSessionsForUser("user-1");
    const after = Date.now();

    expect(mockFrom).toHaveBeenCalledWith("profiles");
    const updatePayload = updateMock.mock.calls[0]![0];
    const writtenTime = new Date(updatePayload.sessions_invalidated_at).getTime();
    expect(writtenTime).toBeGreaterThanOrEqual(before);
    expect(writtenTime).toBeLessThanOrEqual(after);
    // Explicit user filtering, required because this uses the service-role
    // client (bypasses RLS entirely) -- see the function's own doc comment.
    expect(eqMock).toHaveBeenCalledWith("id", "user-1");
    expect(result.error).toBeNull();
  });

  it("propagates the database error to the caller instead of swallowing it", async () => {
    // Regression test: a prior version of this function (and its only
    // caller, /api/auth/logout-all) did not check this write's result at
    // all, so a failure here would silently report success to the client
    // even though sessions_invalidated_at -- the specific column that
    // closes the live-access-token window, §4 -- was never actually set.
    const dbError = new Error("connection reset");
    const eqMock = vi.fn().mockResolvedValue({ error: dbError });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await invalidateAllSessionsForUser("user-1");

    expect(result.error).toBe(dbError);
  });

  it("scopes different users to different rows (no cross-user leakage)", async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    await invalidateAllSessionsForUser("user-a");
    await invalidateAllSessionsForUser("user-b");

    expect(eqMock).toHaveBeenNthCalledWith(1, "id", "user-a");
    expect(eqMock).toHaveBeenNthCalledWith(2, "id", "user-b");
  });
});
