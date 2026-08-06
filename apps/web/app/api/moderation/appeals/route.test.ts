import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/authorization/require-role", () => ({
  requireAuthenticatedCaller: vi.fn(),
  isAuthError: (r: unknown) => r !== null && typeof r === "object" && "errorResponse" in r,
}));
vi.mock("@/lib/authorization/edge-function-proxy", () => ({
  invokeEdgeFunctionAsUser: vi.fn(),
  isErrorResponse: (r: unknown) => r !== null && typeof r === "object" && "errorResponse" in r,
}));

import { NextResponse } from "next/server";
import { requireAuthenticatedCaller } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser } from "@/lib/authorization/edge-function-proxy";
import { POST } from "./route";

const uuid = "11111111-1111-1111-1111-111111111111";
const fakePlayerCaller = {
  supabase: {} as never,
  user: { id: "player-1" } as never,
  accessToken: "player-token",
};

describe("POST /api/moderation/appeals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only requires authentication, not a fixed role -- ordinary players must be able to file", async () => {
    vi.mocked(requireAuthenticatedCaller).mockResolvedValue({
      errorResponse: NextResponse.json(
        { error: { code: "AUTH_INVALID_CREDENTIALS" } },
        { status: 401 },
      ),
    });

    const response = await POST(
      new NextRequest("https://example.com/api/moderation/appeals", {
        method: "POST",
        body: JSON.stringify({ action: "file", disputeId: uuid }),
      }),
    );

    expect(requireAuthenticatedCaller).toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it("forwards a 'file' action from an ordinary authenticated caller -- the participant check lives entirely inside moderator-appeal", async () => {
    vi.mocked(requireAuthenticatedCaller).mockResolvedValue(fakePlayerCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { filed: true } });

    const request = new NextRequest("https://example.com/api/moderation/appeals", {
      method: "POST",
      body: JSON.stringify({ action: "file", disputeId: uuid }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      fakePlayerCaller.supabase,
      "player-token",
      "moderator-appeal",
      { method: "POST", body: { action: "file", disputeId: uuid } },
    );
    expect(body).toEqual({ data: { filed: true } });
  });

  it("forwards a non-participant player's 'file' rejection from moderator-appeal unchanged (this route does not pre-filter it)", async () => {
    vi.mocked(requireAuthenticatedCaller).mockResolvedValue(fakePlayerCaller);
    const forbidden = NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Only dispute participants may file an appeal." } },
      { status: 403 },
    );
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ errorResponse: forbidden });

    const request = new NextRequest("https://example.com/api/moderation/appeals", {
      method: "POST",
      body: JSON.stringify({ action: "file", disputeId: uuid }),
    });
    const response = await POST(request);

    expect(response.status).toBe(403);
  });

  it("forwards a 'decide' action too -- moderator-appeal's own requireAdministrator is the real gate, not this route", async () => {
    vi.mocked(requireAuthenticatedCaller).mockResolvedValue(fakePlayerCaller);
    vi.mocked(invokeEdgeFunctionAsUser).mockResolvedValue({ data: { decided: true } });

    const request = new NextRequest("https://example.com/api/moderation/appeals", {
      method: "POST",
      body: JSON.stringify({
        action: "decide",
        disputeId: uuid,
        resolution: "winner_confirmed",
        rationale: "Reviewed all evidence again.",
      }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(body).toEqual({ data: { decided: true } });
  });

  it("rejects a malformed body", async () => {
    vi.mocked(requireAuthenticatedCaller).mockResolvedValue(fakePlayerCaller);

    const request = new NextRequest("https://example.com/api/moderation/appeals", {
      method: "POST",
      body: JSON.stringify({ action: "file" }), // missing disputeId
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });
});
