import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/authorization/require-role", () => ({
  requireRoleForRoute: vi.fn(),
  isAuthError: (r: unknown) => r !== null && typeof r === "object" && "errorResponse" in r,
}));
vi.mock("@/lib/authorization/edge-function-proxy", () => ({
  invokeEdgeFunctionAsUser: vi.fn(),
  isErrorResponse: (r: unknown) => r !== null && typeof r === "object" && "errorResponse" in r,
}));

import { NextResponse } from "next/server";
import { requireRoleForRoute } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser } from "@/lib/authorization/edge-function-proxy";
import { GET, PATCH } from "./route";

const fakeCaller = {
  supabase: {} as never,
  user: { id: "admin-1" } as never,
  accessToken: "admin-token",
};

describe("GET /api/admin/feature-flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_admin role", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET();

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_admin");
    expect(response.status).toBe(403);
  });

  it("forwards to admin-feature-flags and unwraps the list", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: [{ key: "flag_a" }] });

    const response = await GET();
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "admin-token",
      "admin-feature-flags",
      { method: "GET" },
    );
    expect(body).toEqual({ data: [{ key: "flag_a" }] });
  });
});

describe("PATCH /api/admin/feature-flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a body missing enabled", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/admin/feature-flags", {
      method: "PATCH",
      body: JSON.stringify({ key: "flag_a" }),
    });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid toggle -- the four-eyes dual-approval trigger stays entirely server-side, this route just relays key/enabled", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({
      data: { key: "flag_a", enabled: true },
    });

    const request = new NextRequest("https://example.com/api/admin/feature-flags", {
      method: "PATCH",
      body: JSON.stringify({ key: "flag_a", enabled: true }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "admin-token",
      "admin-feature-flags",
      { method: "PATCH", body: { key: "flag_a", enabled: true } },
    );
    expect(body).toEqual({ data: { key: "flag_a", enabled: true } });
  });
});
