import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/server";
import { checkDeviceFarming } from "./device-farming";

describe("checkDeviceFarming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when the device is under the account-per-device threshold", async () => {
    const rows = [{ user_id: "u1" }, { user_id: "u2" }];
    const gte = vi.fn().mockResolvedValue({ data: rows, error: null });
    const eq = vi.fn().mockReturnValue({ gte });
    const select = vi.fn().mockReturnValue({ eq });
    const fromMock = vi.fn().mockReturnValue({ select });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    await checkDeviceFarming("new-user", "fp-1", 24, 5);

    expect(fromMock).not.toHaveBeenCalledWith("fraud_flags");
  });

  it("raises a multi_account fraud flag once the distinct-account count reaches the threshold", async () => {
    const rows = [
      { user_id: "u1" },
      { user_id: "u2" },
      { user_id: "u3" },
      { user_id: "u4" },
      { user_id: "u5" },
    ];
    const gte = vi.fn().mockResolvedValue({ data: rows, error: null });
    const eqDevices = vi.fn().mockReturnValue({ gte });
    const selectDevices = vi.fn().mockReturnValue({ eq: eqDevices });

    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const containsMock = vi.fn().mockReturnValue({ maybeSingle });
    const eqFlagsStatus = vi.fn().mockReturnValue({ contains: containsMock });
    const eqFlagsUser = vi.fn().mockReturnValue({ eq: eqFlagsStatus });
    const eqFlagsType = vi.fn().mockReturnValue({ eq: eqFlagsUser });
    const selectFlags = vi.fn().mockReturnValue({ eq: eqFlagsType });

    const insertMock = vi.fn().mockResolvedValue({ error: null });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === "devices") return { select: selectDevices };
      return { select: selectFlags, insert: insertMock };
    });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    await checkDeviceFarming("new-user", "fp-1", 24, 5);

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        flag_type: "multi_account",
        primary_user_id: "new-user",
        details: expect.objectContaining({ signal: "mass_account_creation", account_count: 5 }),
      }),
    );
  });

  it("does not raise a duplicate flag when one is already open", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ user_id: `u${i}` }));
    const gte = vi.fn().mockResolvedValue({ data: rows, error: null });
    const eqDevices = vi.fn().mockReturnValue({ gte });
    const selectDevices = vi.fn().mockReturnValue({ eq: eqDevices });

    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "existing-flag" }, error: null });
    const containsMock = vi.fn().mockReturnValue({ maybeSingle });
    const eqFlagsStatus = vi.fn().mockReturnValue({ contains: containsMock });
    const eqFlagsUser = vi.fn().mockReturnValue({ eq: eqFlagsStatus });
    const eqFlagsType = vi.fn().mockReturnValue({ eq: eqFlagsUser });
    const selectFlags = vi.fn().mockReturnValue({ eq: eqFlagsType });

    const insertMock = vi.fn();
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === "devices") return { select: selectDevices };
      return { select: selectFlags, insert: insertMock };
    });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never);

    await checkDeviceFarming("new-user", "fp-1", 24, 5);

    expect(insertMock).not.toHaveBeenCalled();
  });
});
