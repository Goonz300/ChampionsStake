import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
  deleteAllRecoveryCodes,
  regenerateRecoveryCodes,
} from "./recovery-codes";

describe("regenerateRecoveryCodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes existing codes, inserts exactly 10 new hashed codes, and returns the plaintext", async () => {
    const eqDelete = vi.fn().mockResolvedValue({ error: null });
    const deleteMock = vi.fn().mockReturnValue({ eq: eqDelete });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn().mockReturnValue({ delete: deleteMock, insert: insertMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    const result = await regenerateRecoveryCodes("user-1");

    expect(fromMock).toHaveBeenCalledWith("mfa_recovery_codes");
    expect(eqDelete).toHaveBeenCalledWith("user_id", "user-1");
    expect(result.error).toBeNull();
    expect(result.codes).toHaveLength(10);

    // Every code is unique, matches the XXXXX-XXXXX shape, and only its
    // SHA-256 hash -- never the plaintext -- was sent to the database.
    expect(new Set(result.codes).size).toBe(10);
    for (const code of result.codes) {
      expect(code).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    }

    const insertedRows = insertMock.mock.calls[0]![0] as { user_id: string; code_hash: string }[];
    expect(insertedRows).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(insertedRows[i]!.user_id).toBe("user-1");
      // The stored value is exactly the SHA-256 hash of the plaintext
      // code -- not the plaintext itself, and not some other derivation.
      expect(insertedRows[i]!.code_hash).toBe(
        createHash("sha256").update(result.codes[i]!).digest("hex"),
      );
    }
  });

  it("returns the delete error without generating or inserting new codes", async () => {
    const dbError = new Error("connection reset");
    const eqDelete = vi.fn().mockResolvedValue({ error: dbError });
    const deleteMock = vi.fn().mockReturnValue({ eq: eqDelete });
    const insertMock = vi.fn();
    const fromMock = vi.fn().mockReturnValue({ delete: deleteMock, insert: insertMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    const result = await regenerateRecoveryCodes("user-1");

    expect(result).toEqual({ codes: [], error: dbError });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("consumeRecoveryCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds via a single atomic UPDATE ... WHERE used_at IS NULL ... RETURNING statement", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { id: "code-row-1" }, error: null });
    const selectMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const isMock = vi.fn().mockReturnValue({ select: selectMock });
    const eqHash = vi.fn().mockReturnValue({ is: isMock });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const updateMock = vi.fn().mockReturnValue({ eq: eqUser });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    const result = await consumeRecoveryCode("user-1", "abcde-12345");

    // The whole point of the atomic pattern: exactly one UPDATE call,
    // scoped by user, hash, and used_at IS NULL together -- not a
    // SELECT-then-UPDATE that would leave a race window.
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    const usedHash = eqHash.mock.calls[0]![1];
    expect(usedHash).toBe(createHash("sha256").update("abcde-12345").digest("hex"));
    expect(isMock).toHaveBeenCalledWith("used_at", null);
    expect(result).toEqual({ success: true, error: null });
  });

  it("returns success:false (not an error) when the code was already used or never existed", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const isMock = vi.fn().mockReturnValue({ select: selectMock });
    const eqHash = vi.fn().mockReturnValue({ is: isMock });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const updateMock = vi.fn().mockReturnValue({ eq: eqUser });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    // Same outcome shape whether the code is wrong or already used --
    // consumeRecoveryCode itself cannot and does not distinguish them
    // (zero rows returned either way), which is what makes the caller's
    // generic error message honest rather than a leak.
    const result = await consumeRecoveryCode("user-1", "wrong-code0");

    expect(result).toEqual({ success: false, error: null });
  });

  it("propagates a database error distinctly from a simple wrong/used code", async () => {
    const dbError = new Error("connection reset");
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: dbError });
    const selectMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const isMock = vi.fn().mockReturnValue({ select: selectMock });
    const eqHash = vi.fn().mockReturnValue({ is: isMock });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const updateMock = vi.fn().mockReturnValue({ eq: eqUser });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    const result = await consumeRecoveryCode("user-1", "some-code12");

    expect(result).toEqual({ success: false, error: dbError });
  });
});

describe("countUnusedRecoveryCodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts only unused codes for the given user, never returning the codes themselves", async () => {
    const isMock = vi.fn().mockResolvedValue({ count: 7, error: null });
    const eqMock = vi.fn().mockReturnValue({ is: isMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    const result = await countUnusedRecoveryCodes("user-1");

    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(isMock).toHaveBeenCalledWith("used_at", null);
    expect(result).toEqual({ count: 7, error: null });
  });

  it("returns 0 (not null/undefined) when the count is absent", async () => {
    const isMock = vi.fn().mockResolvedValue({ count: null, error: null });
    const eqMock = vi.fn().mockReturnValue({ is: isMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    const result = await countUnusedRecoveryCodes("user-1");

    expect(result.count).toBe(0);
  });
});

describe("deleteAllRecoveryCodes", () => {
  it("scopes the delete to the given user only", async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const deleteMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ delete: deleteMock });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    const result = await deleteAllRecoveryCodes("user-1");

    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual({ error: null });
  });
});
