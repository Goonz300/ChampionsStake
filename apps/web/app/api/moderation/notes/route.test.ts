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

describe("GET /api/moderation/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_moderator role -- notes stay private from players", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(
      new NextRequest(`https://example.com/api/moderation/notes?disputeId=${uuid}`),
    );

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_moderator");
    expect(response.status).toBe(403);
  });

  it("requires a disputeId", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const response = await GET(new NextRequest("https://example.com/api/moderation/notes"));

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards to moderator-note", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: [] });

    await GET(new NextRequest(`https://example.com/api/moderation/notes?disputeId=${uuid}`));

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "mod-token",
      `moderator-note?disputeId=${uuid}`,
      { method: "GET" },
    );
  });
});

describe("POST /api/moderation/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty content", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/moderation/notes", {
      method: "POST",
      body: JSON.stringify({ disputeId: uuid, content: "" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid note and returns 201 -- addNote now audits internally (Phase 3D fix), not duplicated here", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { id: uuid } });

    const request = new NextRequest("https://example.com/api/moderation/notes", {
      method: "POST",
      body: JSON.stringify({ disputeId: uuid, content: "Escalated per player history." }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "mod-token",
      "moderator-note",
      {
        method: "POST",
        body: { disputeId: uuid, content: "Escalated per player history." },
      },
    );
  });
});
