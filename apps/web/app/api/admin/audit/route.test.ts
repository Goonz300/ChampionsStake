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

describe("GET /api/admin/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_admin role -- audit log search is itself a privileged read", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(new NextRequest("https://example.com/api/admin/audit"));

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_admin");
    expect(response.status).toBe(403);
  });

  it("rejects a limit above the maximum", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const response = await GET(new NextRequest("https://example.com/api/admin/audit?limit=99999"));

    expect(response.status).toBe(400);
  });

  it("forwards a filtered search and unwraps the result", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { items: [] } });

    const response = await GET(
      new NextRequest(
        "https://example.com/api/admin/audit?category=moderation&action=ModeratorNoteAdded",
      ),
    );
    const body = await response.json();

    const [, , calledPath] = vi.mocked(invokeEdgeFunctionAsUser).mock.calls[0]!;
    expect(calledPath).toContain("category=moderation");
    expect(calledPath).toContain("action=ModeratorNoteAdded");
    expect(body).toEqual({ data: { items: [] } });
  });
});
