import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";
import {
  isPublicPath,
  isAdminPath,
  isModerationPath,
  isMfaCompletionPath,
  middleware,
} from "./middleware";

describe("isPublicPath", () => {
  it("treats the root and auth pages as public", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/register")).toBe(true);
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/verify-email")).toBe(true);
    expect(isPublicPath("/session-expired")).toBe(true);
    expect(isPublicPath("/access-denied")).toBe(true);
    expect(isPublicPath("/maintenance")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/terms")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/cookies")).toBe(true);
  });

  it("treats app routes as protected (not public)", () => {
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/vault")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
  });

  it("matches subpaths of public prefixes", () => {
    expect(isPublicPath("/auth/callback/extra")).toBe(true);
  });

  it("treats /api/health as public — PROD-001 regression test: external uptime monitors cannot authenticate, so this path must never be gated behind login", () => {
    expect(isPublicPath("/api/health")).toBe(true);
  });
});

describe("isAdminPath", () => {
  it("matches /admin and its subpaths only", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/users")).toBe(true);
    expect(isAdminPath("/admin/moderation")).toBe(true);
  });

  it("does not match unrelated paths, including a similarly-prefixed one", () => {
    expect(isAdminPath("/dashboard")).toBe(false);
    // Regression test: a naive `startsWith("/admin")` check would incorrectly
    // match a hypothetical "/administrator" route. There is no such route in
    // the approved folder structure (Architecture §13), but the check is
    // written to be correct regardless.
    expect(isAdminPath("/administrator")).toBe(false);
  });
});

describe("isModerationPath", () => {
  it("matches only the moderation subpath of admin", () => {
    expect(isModerationPath("/admin/moderation")).toBe(true);
    expect(isModerationPath("/admin/moderation/disputes")).toBe(true);
    expect(isModerationPath("/admin/users")).toBe(false);
  });
});

describe("isMfaCompletionPath", () => {
  it("matches exactly the endpoints a pending-MFA session needs to finish or abandon login", () => {
    expect(isMfaCompletionPath("/api/auth/mfa/verify")).toBe(true);
    expect(isMfaCompletionPath("/api/auth/mfa/recovery-codes/verify")).toBe(true);
    expect(isMfaCompletionPath("/api/auth/logout")).toBe(true);
  });

  it("does not match settings-only MFA endpoints, which correctly stay behind the pending-MFA gate", () => {
    // Regression test: enroll/disable/regenerate all require a session that
    // has ALREADY completed login, not one still pending its second factor
    // — an mfa-completion allowlist that accidentally included these would
    // reopen the gap this gate exists to close.
    expect(isMfaCompletionPath("/api/auth/mfa/enroll")).toBe(false);
    expect(isMfaCompletionPath("/api/auth/mfa/disable")).toBe(false);
    expect(isMfaCompletionPath("/api/auth/mfa/recovery-codes/regenerate")).toBe(false);
  });

  it("does not match unrelated paths", () => {
    expect(isMfaCompletionPath("/dashboard")).toBe(false);
    expect(isMfaCompletionPath("/api/auth/login")).toBe(false);
  });
});

describe("middleware admin/moderator gating (Phase 3D: single source of truth via RPC)", () => {
  const authedUser = { id: "user-1", email: "admin@example.com" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSupabaseClient(rpcSpy: ReturnType<typeof vi.fn>) {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { enabled: false } });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    return { from: fromMock, rpc: rpcSpy };
  }

  function makeRequest(pathname: string): NextRequest {
    return new NextRequest(`https://example.com${pathname}`);
  }

  async function setup(rpcResult: boolean | null) {
    const { NextResponse } = await import("next/server");
    const rpcSpy = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
    vi.mocked(updateSession).mockResolvedValue({
      response: NextResponse.next(),
      user: authedUser,
      mfaSatisfied: true,
    } as never);
    vi.mocked(createServerClient).mockReturnValue(mockSupabaseClient(rpcSpy) as never);
    return rpcSpy;
  }

  it("calls is_admin (not is_moderator) for a non-moderation admin path", async () => {
    const rpcSpy = await setup(true);

    const response = await middleware(makeRequest("/admin/users"));

    expect(rpcSpy).toHaveBeenCalledWith("is_admin", {});
    expect(response.headers.get("location")).toBeNull();
  });

  it("calls is_moderator (not is_admin) for the moderation subpath", async () => {
    const rpcSpy = await setup(true);

    const response = await middleware(makeRequest("/admin/moderation/disputes"));

    expect(rpcSpy).toHaveBeenCalledWith("is_moderator", {});
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects to /access-denied when the RPC returns false", async () => {
    await setup(false);

    const response = await middleware(makeRequest("/admin/users"));

    expect(response.headers.get("location")).toContain("/access-denied");
  });

  it("redirects to /access-denied when the RPC returns null (e.g. a query error), never fails open", async () => {
    // Regression test: this middleware no longer separately checks
    // profiles.status, since is_admin()/is_moderator() already fold that
    // check in — but that also means a null/undefined RPC result (a
    // suspended account, a missing profile row, or a transient error) must
    // still deny access, not silently pass through.
    await setup(null);

    const response = await middleware(makeRequest("/admin/users"));

    expect(response.headers.get("location")).toContain("/access-denied");
  });

  it("never calls the role RPC at all for a non-admin path", async () => {
    const rpcSpy = await setup(true);

    await middleware(makeRequest("/dashboard"));

    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
