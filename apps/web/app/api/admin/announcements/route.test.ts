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
import { GET, POST, PATCH } from "./route";

const uuid = "11111111-1111-1111-1111-111111111111";
const fakeCaller = {
  supabase: {} as never,
  user: { id: "admin-1" } as never,
  accessToken: "admin-token",
};

describe("GET /api/admin/announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_admin role", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(new NextRequest("https://example.com/api/admin/announcements"));

    expect(response.status).toBe(403);
  });
});

describe("POST /api/admin/announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a title that is empty", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/admin/announcements", {
      method: "POST",
      body: JSON.stringify({ category: "platform_notice", title: "", body: "text" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid announcement and returns 201", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { id: uuid } });

    const request = new NextRequest("https://example.com/api/admin/announcements", {
      method: "POST",
      body: JSON.stringify({ category: "maintenance", title: "Scheduled downtime", body: "..." }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });
});

describe("PATCH /api/admin/announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards a publish action", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { updated: true } });

    const request = new NextRequest("https://example.com/api/admin/announcements", {
      method: "PATCH",
      body: JSON.stringify({ action: "publish", announcementId: uuid }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "admin-token",
      "admin-announcements",
      { method: "PATCH", body: { action: "publish", announcementId: uuid } },
    );
    expect(body).toEqual({ data: { updated: true } });
  });
});
