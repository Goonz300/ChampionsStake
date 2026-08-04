import { describe, expect, it } from "vitest";
import { isPublicPath, isAdminPath, isModerationPath } from "./middleware";

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
