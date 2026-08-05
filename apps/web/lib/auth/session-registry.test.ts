import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  invalidateAllSessionsForUser,
  listSessionsForUser,
  recordSession,
  revokeAllSessionsForUser,
  revokeOtherSessions,
  revokeSessionByToken,
} from "./session-registry";

describe("recordSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a hashed (never raw) refresh token into user_sessions, with a null device_id by default", async () => {
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
    expect(insertedRow.device_id).toBeNull();
  });

  it("links the session to a device when a deviceId is supplied (migration 0072)", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockFrom = vi.fn().mockReturnValue({ insert: insertMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    await recordSession(
      "user-1",
      "raw-refresh-token",
      "1.2.3.4",
      "TestAgent/1.0",
      new Date("2026-01-01T00:00:00Z"),
      "device-42",
    );

    const insertedRow = insertMock.mock.calls[0]![0];
    expect(insertedRow.device_id).toBe("device-42");
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

describe("listSessionsForUser", () => {
  const rows = [
    {
      id: "s1",
      device_id: "d1",
      ip_address: "1.2.3.4",
      user_agent: "UA1",
      created_at: "2026-01-02T00:00:00Z",
      expires_at: "2026-01-09T00:00:00Z",
      revoked_at: null,
      refresh_token_hash: "aaaa",
    },
    {
      id: "s2",
      device_id: "d2",
      ip_address: "5.6.7.8",
      user_agent: "UA2",
      created_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-01-08T00:00:00Z",
      revoked_at: null,
      refresh_token_hash: "bbbb",
    },
  ];

  function mockSupabaseReturning(data: unknown, error: unknown = null) {
    const orderMock = vi.fn().mockResolvedValue({ data, error });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    return { from: fromMock } as never;
  }

  it("marks no row as current when no refresh token is supplied, and never leaks refresh_token_hash to the caller", async () => {
    const supabase = mockSupabaseReturning(rows);

    const result = await listSessionsForUser(supabase, undefined);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data.every((s) => s.is_current === false)).toBe(true);
    for (const item of result.data) {
      expect(Object.prototype.hasOwnProperty.call(item, "refresh_token_hash")).toBe(false);
    }
  });

  it("computes is_current by hashing the supplied token the same way sessions are recorded", async () => {
    const { createHash } = await import("node:crypto");
    const rawToken = "the-actual-current-refresh-token";
    const hash = createHash("sha256").update(rawToken).digest("hex");

    const rowsWithRealHash = [
      { ...rows[0], id: "s1", refresh_token_hash: hash },
      { ...rows[1], id: "s2" },
    ];
    const supabase = mockSupabaseReturning(rowsWithRealHash);

    const result = await listSessionsForUser(supabase, rawToken);

    const current = result.data.find((s) => s.id === "s1");
    const other = result.data.find((s) => s.id === "s2");
    expect(current?.is_current).toBe(true);
    expect(other?.is_current).toBe(false);
  });

  it("returns an empty array, not null, when there is no data", async () => {
    const supabase = mockSupabaseReturning(null);
    const result = await listSessionsForUser(supabase);
    expect(result.data).toEqual([]);
  });

  it("propagates a database error to the caller", async () => {
    const dbError = new Error("connection reset");
    const supabase = mockSupabaseReturning(null, dbError);
    const result = await listSessionsForUser(supabase);
    expect(result.error).toBe(dbError);
  });
});

describe("revokeOtherSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes only other, currently-active sessions for the user, and returns the count", async () => {
    const isMock = vi.fn().mockResolvedValue({ error: null, count: 2 });
    const neqMock = vi.fn().mockReturnValue({ is: isMock });
    const eqMock = vi.fn().mockReturnValue({ neq: neqMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await revokeOtherSessions("user-1", "current-raw-token");

    expect(mockFrom).toHaveBeenCalledWith("user_sessions");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: expect.any(String) }),
      { count: "exact" },
    );
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    // Must exclude the CURRENT session's own hash, never its raw token.
    const excludedHash = neqMock.mock.calls[0]![1];
    expect(excludedHash).not.toBe("current-raw-token");
    expect(excludedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(isMock).toHaveBeenCalledWith("revoked_at", null);
    expect(result).toEqual({ count: 2, error: null });
  });

  it("returns count 0 (not null/undefined) when nothing needed revoking", async () => {
    const isMock = vi.fn().mockResolvedValue({ error: null, count: 0 });
    const neqMock = vi.fn().mockReturnValue({ is: isMock });
    const eqMock = vi.fn().mockReturnValue({ neq: neqMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await revokeOtherSessions("user-1", "current-raw-token");

    expect(result.count).toBe(0);
  });

  it("propagates a database error to the caller", async () => {
    const dbError = new Error("connection reset");
    const isMock = vi.fn().mockResolvedValue({ error: dbError, count: null });
    const neqMock = vi.fn().mockReturnValue({ is: isMock });
    const eqMock = vi.fn().mockReturnValue({ neq: neqMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const mockFrom = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: mockFrom } as never);

    const result = await revokeOtherSessions("user-1", "current-raw-token");

    expect(result.error).toBe(dbError);
  });
});
