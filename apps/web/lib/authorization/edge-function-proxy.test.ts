import { describe, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "./edge-function-proxy";

function mockSupabase(invokeImpl: () => Promise<{ data: unknown; error: unknown }>) {
  return { functions: { invoke: vi.fn().mockImplementation(invokeImpl) } };
}

describe("invokeEdgeFunctionAsUser", () => {
  it("forwards the caller's own access token, never a service-role key, in the Authorization header", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: { ok: true } }, error: null });
    const supabase = { functions: { invoke } };

    await invokeEdgeFunctionAsUser(supabase as never, "the-callers-own-token", "admin-users", {
      method: "GET",
    });

    expect(invoke).toHaveBeenCalledWith(
      "admin-users",
      expect.objectContaining({
        headers: { Authorization: "Bearer the-callers-own-token" },
      }),
    );
  });

  it("unwraps the standard {data:...} envelope on success", async () => {
    const supabase = mockSupabase(async () => ({
      data: { data: { users: ["a", "b"] } },
      error: null,
    }));

    const result = await invokeEdgeFunctionAsUser(supabase as never, "token", "admin-users", {
      method: "GET",
    });

    expect(isErrorResponse(result)).toBe(false);
    if (!isErrorResponse(result)) {
      expect(result.data).toEqual({ users: ["a", "b"] });
    }
  });

  it("forwards the Edge Function's exact status code and error body on a non-2xx response", async () => {
    const responseBody = {
      error: { code: "FORBIDDEN", message: "Administrator privileges required." },
    };
    const fakeResponse = {
      status: 403,
      json: vi.fn().mockResolvedValue(responseBody),
    } as unknown as Response;
    const supabase = mockSupabase(async () => ({
      data: null,
      error: new FunctionsHttpError(fakeResponse),
    }));

    const result = await invokeEdgeFunctionAsUser(supabase as never, "token", "admin-users", {
      method: "GET",
    });

    expect(isErrorResponse(result)).toBe(true);
    if (isErrorResponse(result)) {
      expect(result.errorResponse.status).toBe(403);
      const body = await result.errorResponse.json();
      expect(body).toEqual(responseBody);
    }
  });

  it("returns a 502 for a network-level failure reaching the Edge Function (not the Edge Function's own error)", async () => {
    const supabase = mockSupabase(async () => ({
      data: null,
      error: new Error("fetch failed"),
    }));

    const result = await invokeEdgeFunctionAsUser(supabase as never, "token", "admin-users", {
      method: "GET",
    });

    expect(isErrorResponse(result)).toBe(true);
    if (isErrorResponse(result)) {
      expect(result.errorResponse.status).toBe(502);
    }
  });

  it("passes POST bodies through unmodified", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: { ok: true } }, error: null });
    const supabase = { functions: { invoke } };
    const body = { action: "suspend", userId: "u1", reasonCode: "fraud", notes: "" };

    await invokeEdgeFunctionAsUser(supabase as never, "token", "admin-users", {
      method: "POST",
      body,
    });

    expect(invoke).toHaveBeenCalledWith(
      "admin-users",
      expect.objectContaining({ body, method: "POST" }),
    );
  });
});
