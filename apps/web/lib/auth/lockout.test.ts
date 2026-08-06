import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  serverEnv: {},
}));

import { createServiceRoleClient } from "@/lib/supabase/server";
import { clearLockoutsForEmail, isAccountLocked, recordLockout, shouldLock } from "./lockout";

describe("isAccountLocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is not locked when no lockout row exists", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    const result = await isAccountLocked("player@example.com", "1.2.3.4");
    expect(result).toEqual({ locked: false, lockedUntil: null });
  });

  it("is not locked once locked_until has elapsed", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const maybeSingle = vi.fn().mockResolvedValue({ data: { locked_until: past }, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    const result = await isAccountLocked("player@example.com", "1.2.3.4");
    expect(result.locked).toBe(false);
  });

  it("is locked while locked_until is still in the future", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const maybeSingle = vi.fn().mockResolvedValue({ data: { locked_until: future }, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    const result = await isAccountLocked("player@example.com", "1.2.3.4");
    expect(result).toEqual({ locked: true, lockedUntil: future });
  });

  it("fails open (not locked) if the lockout-state query errors", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("db down") });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    const result = await isAccountLocked("player@example.com", "1.2.3.4");
    expect(result.locked).toBe(false);
  });
});

describe("shouldLock", () => {
  it("locks once the recent failure count reaches the default threshold (5)", () => {
    expect(shouldLock(4)).toBe(false);
    expect(shouldLock(5)).toBe(true);
    expect(shouldLock(6)).toBe(true);
  });
});

describe("recordLockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks with lock_count=1 when no prior lockout row exists for this identity", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ select, upsert }),
      rpc,
    } as never);

    await recordLockout("player@example.com", "1.2.3.4");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "player@example.com",
        ip_address: "1.2.3.4",
        lock_count: 1,
      }),
      { onConflict: "email,ip_address" },
    );
    expect(rpc).toHaveBeenCalledWith(
      "fn_write_audit_log",
      expect.objectContaining({ p_action: "AccountLocked", p_target_id: "player@example.com" }),
    );
  });

  it("escalates lock_count and doubles the lockout duration on a repeated lockout", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { lock_count: 2 }, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ select, upsert }),
      rpc,
    } as never);

    const before = Date.now();
    await recordLockout("player@example.com", "1.2.3.4");

    const upsertArg = upsert.mock.calls[0]?.[0] as { lock_count: number; locked_until: string };
    expect(upsertArg.lock_count).toBe(3);
    // Default initial=15min, doubled twice for the 3rd lock -> 60 minutes.
    const lockedUntilMs = new Date(upsertArg.locked_until).getTime();
    expect(lockedUntilMs - before).toBeGreaterThan(55 * 60 * 1000);
    expect(lockedUntilMs - before).toBeLessThan(65 * 60 * 1000);
  });
});

describe("clearLockoutsForEmail", () => {
  it("deletes every lockout row for the email and audits the unlock", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockReturnValue({ eq });
    const rpc = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ delete: del }),
      rpc,
    } as never);

    await clearLockoutsForEmail("player@example.com", "admin-1");

    expect(eq).toHaveBeenCalledWith("email", "player@example.com");
    expect(rpc).toHaveBeenCalledWith(
      "fn_write_audit_log",
      expect.objectContaining({
        p_action: "AccountUnlocked",
        p_actor_id: "admin-1",
        p_actor_type: "administrator",
      }),
    );
  });
});
