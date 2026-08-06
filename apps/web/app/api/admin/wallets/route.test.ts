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
import { FunctionsHttpError } from "@supabase/supabase-js";
import { requireRoleForRoute } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser } from "@/lib/authorization/edge-function-proxy";
import { GET, POST } from "./route";

const uuid = "11111111-1111-1111-1111-111111111111";
const fakeCaller = {
  supabase: { functions: { invoke: vi.fn() } } as never,
  user: { id: "admin-1" } as never,
  accessToken: "admin-token",
};

describe("GET /api/admin/wallets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the is_admin role", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue({
      errorResponse: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await GET(
      new NextRequest(`https://example.com/api/admin/wallets?userId=${uuid}`),
    );

    expect(requireRoleForRoute).toHaveBeenCalledWith("is_admin");
    expect(response.status).toBe(403);
  });

  it("requires userId (query validation rejects without it)", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const response = await GET(new NextRequest("https://example.com/api/admin/wallets"));

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("rejects the statement view without from/to", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const response = await GET(
      new NextRequest(`https://example.com/api/admin/wallets?userId=${uuid}&view=statement`),
    );

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards the Edge Function's real error status/body for the csv statement path, not a generic 502 (independent-review fix)", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    const errorBody = { error: { code: "NOT_FOUND", message: "No wallet found for that user." } };
    const fakeResponse = {
      status: 404,
      json: vi.fn().mockResolvedValue(errorBody),
    } as unknown as Response;
    const invokeMock = (
      fakeCaller.supabase as unknown as { functions: { invoke: ReturnType<typeof vi.fn> } }
    ).functions.invoke;
    invokeMock.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeResponse),
    });

    const response = await GET(
      new NextRequest(
        `https://example.com/api/admin/wallets?userId=${uuid}&view=statement&format=csv&from=2026-01-01T00:00:00Z&to=2026-01-31T00:00:00Z`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual(errorBody);
  });

  it("forwards a valid balance query and unwraps the response", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { availableCents: 500 } });

    const response = await GET(
      new NextRequest(`https://example.com/api/admin/wallets?userId=${uuid}`),
    );
    const body = await response.json();

    expect(body).toEqual({ data: { availableCents: 500 } });
  });
});

describe("POST /api/admin/wallets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a freeze request missing a reason", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);

    const request = new NextRequest("https://example.com/api/admin/wallets", {
      method: "POST",
      body: JSON.stringify({ action: "freeze", walletId: uuid }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("forwards a valid freeze action", async () => {
    vi.mocked(requireRoleForRoute).mockResolvedValue(fakeCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { frozen: true } });

    const request = new NextRequest("https://example.com/api/admin/wallets", {
      method: "POST",
      body: JSON.stringify({ action: "freeze", walletId: uuid, reason: "suspicious activity" }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakeCaller.supabase,
      "admin-token",
      "admin-wallets",
      {
        method: "POST",
        body: { action: "freeze", walletId: uuid, reason: "suspicious activity" },
      },
    );
    expect(body).toEqual({ data: { frozen: true } });
  });
});
