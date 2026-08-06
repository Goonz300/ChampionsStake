import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireRoleForRoute, requireAuthenticatedCaller, isAuthError } from "./require-role";

function mockSupabase(opts: {
  user?: { id: string; email?: string } | null;
  rpcResult?: boolean | null;
  session?: { access_token: string } | null;
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: opts.user ?? null } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: opts.session ?? null } }),
    },
    rpc: vi.fn().mockResolvedValue({ data: opts.rpcResult ?? null, error: null }),
  };
}

describe("requireRoleForRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a 401 error response when there is no authenticated user", async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await requireRoleForRoute("is_admin");

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.errorResponse.status).toBe(401);
    }
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("calls the named RPC (single source of truth, same as RLS/middleware) and returns a 403 when it returns false", async () => {
    const supabase = mockSupabase({ user: { id: "u1" }, rpcResult: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await requireRoleForRoute("is_admin");

    expect(supabase.rpc).toHaveBeenCalledWith("is_admin", {});
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.errorResponse.status).toBe(403);
    }
  });

  it("fails closed (403) when the RPC returns null, e.g. a suspended account or query error", async () => {
    const supabase = mockSupabase({ user: { id: "u1" }, rpcResult: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await requireRoleForRoute("is_moderator");

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.errorResponse.status).toBe(403);
    }
  });

  it("returns the caller with an access token when authenticated and authorized", async () => {
    const supabase = mockSupabase({
      user: { id: "u1" },
      rpcResult: true,
      session: { access_token: "real-access-token" },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await requireRoleForRoute("is_admin");

    expect(isAuthError(result)).toBe(false);
    if (!isAuthError(result)) {
      expect(result.user.id).toBe("u1");
      expect(result.accessToken).toBe("real-access-token");
    }
  });

  it("returns 401 if the session vanished between getUser and getSession (defensive, should not normally happen)", async () => {
    const supabase = mockSupabase({ user: { id: "u1" }, rpcResult: true, session: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await requireRoleForRoute("is_admin");

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.errorResponse.status).toBe(401);
    }
  });
});

describe("requireAuthenticatedCaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a 401 error response when there is no authenticated user", async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await requireAuthenticatedCaller();

    expect(isAuthError(result)).toBe(true);
  });

  it("never calls any role RPC -- authorization is entirely the caller's responsibility for mixed-auth routes", async () => {
    const supabase = mockSupabase({
      user: { id: "u1" },
      session: { access_token: "token" },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await requireAuthenticatedCaller();

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns the caller with an access token for any authenticated user, regardless of role", async () => {
    const supabase = mockSupabase({
      user: { id: "any-player" },
      session: { access_token: "token" },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await requireAuthenticatedCaller();

    expect(isAuthError(result)).toBe(false);
    if (!isAuthError(result)) {
      expect(result.user.id).toBe("any-player");
    }
  });
});
