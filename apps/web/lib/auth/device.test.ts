import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/server";
import { deriveDeviceFingerprint, listDevicesForUser, recordDevice } from "./device";

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

describe("recordDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates last_seen_at and does not log NewDeviceLogin for an already-known fingerprint", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { id: "device-1" } });
    const eqLookup2 = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqLookup1 = vi.fn().mockReturnValue({ eq: eqLookup2 });
    const selectMock = vi.fn().mockReturnValue({ eq: eqLookup1 });

    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqUpdate });

    const insertMock = vi.fn();
    const rpcMock = vi.fn();
    const fromMock = vi.fn().mockReturnValue({
      select: selectMock,
      update: updateMock,
      insert: insertMock,
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: fromMock,
      rpc: rpcMock,
    } as never);

    const result = await recordDevice("user-1", "fingerprint-abc", null, "Mozilla/5.0");

    expect(result).toEqual({ deviceId: "device-1", isNewDevice: false });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ last_seen_at: expect.any(String) }),
    );
    expect(eqUpdate).toHaveBeenCalledWith("id", "device-1");
    expect(insertMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("inserts a new row and logs NewDeviceLogin for an unseen fingerprint", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null });
    const eqLookup2 = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqLookup1 = vi.fn().mockReturnValue({ eq: eqLookup2 });
    const selectLookupMock = vi.fn().mockReturnValue({ eq: eqLookup1 });

    const singleMock = vi.fn().mockResolvedValue({ data: { id: "device-2" }, error: null });
    const selectInsertMock = vi.fn().mockReturnValue({ single: singleMock });
    const insertMock = vi.fn().mockReturnValue({ select: selectInsertMock });

    const rpcMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn().mockReturnValue({
      select: selectLookupMock,
      insert: insertMock,
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: fromMock,
      rpc: rpcMock,
    } as never);

    const result = await recordDevice("user-1", "fingerprint-new", "web", "Mozilla/5.0 New");

    expect(result).toEqual({ deviceId: "device-2", isNewDevice: true });
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      device_fingerprint: "fingerprint-new",
      platform: "web",
      user_agent: "Mozilla/5.0 New",
      last_ip_address: null,
      country_code: null,
    });
    // The audit event must reference the actual new row, not a placeholder.
    expect(rpcMock).toHaveBeenCalledWith(
      "fn_write_audit_log",
      expect.objectContaining({
        p_action: "NewDeviceLogin",
        p_target_table: "devices",
        p_target_id: "device-2",
        p_actor_id: "user-1",
      }),
    );
  });

  it("records device_ip_history and last_ip_address/country_code when an IP is supplied", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { id: "device-1" } });
    const eqLookup2 = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqLookup1 = vi.fn().mockReturnValue({ eq: eqLookup2 });
    const selectMock = vi.fn().mockReturnValue({ eq: eqLookup1 });

    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqUpdate });

    const ipHistoryInsertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn().mockReturnValue({
      select: selectMock,
      update: updateMock,
      insert: ipHistoryInsertMock,
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    await recordDevice("user-1", "fingerprint-abc", null, "Mozilla/5.0", "203.0.113.9", "NG");

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ last_ip_address: "203.0.113.9", country_code: "NG" }),
    );
    expect(fromMock).toHaveBeenCalledWith("device_ip_history");
    expect(ipHistoryInsertMock).toHaveBeenCalledWith({
      device_id: "device-1",
      ip_address: "203.0.113.9",
      country_code: "NG",
    });
  });

  it("does not fail the caller if the audit log RPC itself throws (fire-and-isolate)", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null });
    const eqLookup2 = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqLookup1 = vi.fn().mockReturnValue({ eq: eqLookup2 });
    const selectLookupMock = vi.fn().mockReturnValue({ eq: eqLookup1 });

    const singleMock = vi.fn().mockResolvedValue({ data: { id: "device-3" }, error: null });
    const selectInsertMock = vi.fn().mockReturnValue({ single: singleMock });
    const insertMock = vi.fn().mockReturnValue({ select: selectInsertMock });

    const rpcMock = vi.fn().mockRejectedValue(new Error("audit log down"));
    const fromMock = vi.fn().mockReturnValue({
      select: selectLookupMock,
      insert: insertMock,
    });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: fromMock,
      rpc: rpcMock,
    } as never);

    // Must resolve, not reject, even though the audit RPC rejected.
    const result = await recordDevice("user-1", "fingerprint-x", null, null);
    expect(result).toEqual({ deviceId: "device-3", isNewDevice: true });
  });
});

describe("listDevicesForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns devices ordered by last_seen_at descending", async () => {
    const rows = [
      {
        id: "d1",
        device_fingerprint: "fp1",
        platform: null,
        user_agent: "UA1",
        first_seen_at: "t1",
        last_seen_at: "t2",
      },
    ];
    const orderMock = vi.fn().mockResolvedValue({ data: rows, error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    const supabase = { from: fromMock } as never;

    const result = await listDevicesForUser(supabase);

    expect(fromMock).toHaveBeenCalledWith("devices");
    expect(orderMock).toHaveBeenCalledWith("last_seen_at", { ascending: false });
    expect(result).toEqual({ data: rows, error: null });
  });

  it("returns an empty array (not null/undefined) when there is no data", async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    const supabase = { from: fromMock } as never;

    const result = await listDevicesForUser(supabase);

    expect(result.data).toEqual([]);
  });
});
