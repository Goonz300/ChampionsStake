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
import { GET } from "./route";

const fakeCaller = {
  supabase: {} as never,
  user: { id: "admin-1" } as never,
  accessToken: "admin-token",
};

describe("GET /api/admin/system-health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_admin role", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(new NextRequest("https://example.com/api/admin/system-health"));

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_admin");
    expect(response.status).toBe(403);
  });

  it("rejects an invalid view value", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const response = await GET(
      new NextRequest("https://example.com/api/admin/system-health?view=not-a-real-view"),
    );

    expect(response.status).toBe(400);
  });

  it("defaults to the health view and forwards it", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { status: "ok" } });

    const response = await GET(new NextRequest("https://example.com/api/admin/system-health"));
    const body = await response.json();

    const [, , calledPath] = vi.mocked(invokeEdgeFunctionAsUser).mock.calls[0]!;
    expect(calledPath).toContain("view=health");
    expect(body).toEqual({ data: { status: "ok" } });
  });
});
