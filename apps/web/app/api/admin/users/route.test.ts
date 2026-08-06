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
import { GET, POST } from "./route";

const fakeCaller = {
  supabase: {} as never,
  user: { id: "admin-1" } as never,
  accessToken: "admin-token",
};

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_admin role (not is_moderator)", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(new NextRequest("https://example.com/api/admin/users"));

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_admin");
    expect(response.status).toBe(403);
  });

  it("rejects the summary view without a userId with a 400, before ever calling the Edge Function", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const response = await GET(new NextRequest("https://example.com/api/admin/users?view=summary"));

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid search query to admin-users and returns its data unwrapped", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { items: [] } });

    const response = await GET(
      new NextRequest("https://example.com/api/admin/users?view=search&search=alice"),
    );
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "admin-token",
      expect.stringContaining("admin-users?"),
      { method: "GET" },
    );
    const [, , calledPath] = vi.mocked(invokeEdgeFunctionAsUser).mock.calls[0]!;
    expect(calledPath).toContain("search=alice");
    expect(body).toEqual({ data: { items: [] } });
  });
});

describe("POST /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a malformed body with 400 without reaching the Edge Function", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ action: "suspend" }), // missing userId/reasonCode
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid suspend action exactly as validated, no extra fields smuggled through", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { suspended: true } });

    const request = new NextRequest("https://example.com/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        action: "suspend",
        userId: "11111111-1111-1111-1111-111111111111",
        reasonCode: "fraud",
        notes: "flagged by trust score",
        maliciousExtraField: "should be dropped by zod",
      }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "admin-token",
      "admin-users",
      {
        method: "POST",
        body: {
          action: "suspend",
          userId: "11111111-1111-1111-1111-111111111111",
          reasonCode: "fraud",
          notes: "flagged by trust score",
        },
      },
    );
    expect(body).toEqual({ data: { suspended: true } });
  });

  it("propagates the Edge Function's own error response (e.g. a 403) unchanged", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    const edgeError = NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Administrator privileges required." } },
      { status: 403 },
    );
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ errorResponse: edgeError });

    const request = new NextRequest("https://example.com/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ action: "reinstate", userId: "11111111-1111-1111-1111-111111111111" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(403);
  });
});
