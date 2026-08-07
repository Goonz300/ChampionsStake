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

describe("GET /api/admin/security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_admin role", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(new NextRequest("https://example.com/api/admin/security"));

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_admin");
    expect(response.status).toBe(403);
  });

  it("defaults to the abuse_stats view and forwards it to admin-security", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { failed_logins: 3 } });

    const response = await GET(new NextRequest("https://example.com/api/admin/security"));
    const body = await response.json();

    const [, , calledPath] = vi.mocked(invokeEdgeFunctionAsUser).mock.calls[0]!;
    expect(calledPath).toContain("view=abuse_stats");
    expect(body).toEqual({ data: { failed_logins: 3 } });
  });

  it("forwards the locked_accounts view", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: [] });

    await GET(new NextRequest("https://example.com/api/admin/security?view=locked_accounts"));

    const [, , calledPath] = vi.mocked(invokeEdgeFunctionAsUser).mock.calls[0]!;
    expect(calledPath).toContain("view=locked_accounts");
  });
});

describe("POST /api/admin/security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a malformed body with 400 without reaching the Edge Function", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/admin/security", {
      method: "POST",
      body: JSON.stringify({ action: "unlock_account" }), // missing email
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid unlock_account action exactly as validated", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { unlocked: true } });

    const request = new NextRequest("https://example.com/api/admin/security", {
      method: "POST",
      body: JSON.stringify({
        action: "unlock_account",
        email: "player@example.com",
        maliciousExtraField: "should be dropped by zod",
      }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "admin-token",
      "admin-security",
      { method: "POST", body: { action: "unlock_account", email: "player@example.com" } },
    );
    expect(body).toEqual({ data: { unlocked: true } });
  });

  it("propagates the Edge Function's own error response unchanged", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    const edgeError = NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Administrator privileges required." } },
      { status: 403 },
    );
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ errorResponse: edgeError });

    const request = new NextRequest("https://example.com/api/admin/security", {
      method: "POST",
      body: JSON.stringify({
        action: "review_fraud_flag",
        flagId: "11111111-1111-1111-1111-111111111111",
        outcome: "reviewed_cleared",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(403);
  });
});
