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

const uuid = "11111111-1111-1111-1111-111111111111";
const fakeCaller = {
  supabase: {} as never,
  user: { id: "mod-1" } as never,
  accessToken: "mod-token",
};

describe("GET /api/moderation/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_moderator role (not is_admin)", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET();

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_moderator");
    expect(response.status).toBe(403);
  });

  it("forwards to moderator-dashboard's queue view", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: [] });

    await GET();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "mod-token",
      "moderator-dashboard?view=queue",
      { method: "GET" },
    );
  });
});

describe("POST /api/moderation/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unsupported action", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/moderation/queue", {
      method: "POST",
      body: JSON.stringify({ action: "delete_everything", disputeId: uuid }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a claim action to moderator-assign -- the finer assign-only-by-admin rule stays inside that function, not re-derived here", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { claimed: true } });

    const request = new NextRequest("https://example.com/api/moderation/queue", {
      method: "POST",
      body: JSON.stringify({ action: "claim", disputeId: uuid }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "mod-token",
      "moderator-assign",
      {
        method: "POST",
        body: { action: "claim", disputeId: uuid },
      },
    );
    expect(body).toEqual({ data: { claimed: true } });
  });
});
