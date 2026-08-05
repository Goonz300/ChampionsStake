import { describe, expect, it, beforeEach, vi } from "vitest";

describe("env loader", () => {
  const REQUIRED_VARS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_APP_URL",
  ];

  beforeEach(() => {
    vi.resetModules();
    for (const key of REQUIRED_VARS) {
      process.env[key] = `test-${key}`;
    }
  });

  it("loads clientEnv successfully when all required vars are present", async () => {
    const { clientEnv } = await import("./env");
    expect(clientEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(
      "test-NEXT_PUBLIC_SUPABASE_URL",
    );
  });

  it("throws a clear error when a required client var is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(import("./env")).rejects.toThrow(
      /Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("throws when serverEnv is accessed without required secrets configured", async () => {
    const { serverEnv } = await import("./env");
    expect(() => serverEnv.RESEND_API_KEY).toThrow(
      /Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("resolves serverEnv fields once all server secrets are configured", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.RESEND_API_KEY = "test-resend";

    const { serverEnv } = await import("./env");
    expect(serverEnv.RESEND_API_KEY).toBe("test-resend");
    expect(serverEnv.KYC_PROVIDER_KEY).toBeUndefined();
  });
});
