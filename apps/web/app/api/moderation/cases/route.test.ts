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

describe("GET /api/moderation/cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_moderator role", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(
      new NextRequest(`https://example.com/api/moderation/cases?disputeId=${uuid}`),
    );

    expect(response.status).toBe(403);
  });

  it("requires a disputeId", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const response = await GET(new NextRequest("https://example.com/api/moderation/cases"));

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards to moderator-dashboard's case view", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { id: uuid } });

    await GET(new NextRequest(`https://example.com/api/moderation/cases?disputeId=${uuid}`));

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "mod-token",
      `moderator-dashboard?view=case&disputeId=${uuid}`,
      { method: "GET" },
    );
  });
});

describe("POST /api/moderation/cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a rationale shorter than 10 characters", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/moderation/cases", {
      method: "POST",
      body: JSON.stringify({ action: "approve_winner", disputeId: uuid, rationale: "too short" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid approve_winner decision to moderator-decision -- the fund-moving path stays entirely inside that function", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { processed: true } });

    const request = new NextRequest("https://example.com/api/moderation/cases", {
      method: "POST",
      body: JSON.stringify({
        action: "approve_winner",
        disputeId: uuid,
        rationale: "Evidence clearly supports the claim.",
      }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "mod-token",
      "moderator-decision",
      {
        method: "POST",
        body: {
          action: "approve_winner",
          disputeId: uuid,
          rationale: "Evidence clearly supports the claim.",
        },
      },
    );
    expect(body).toEqual({ data: { processed: true } });
  });
});
