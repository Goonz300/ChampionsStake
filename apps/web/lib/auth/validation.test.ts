import { describe, expect, it } from "vitest";
import {
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "./validation";

describe("registerSchema", () => {
  it("accepts valid registration input", () => {
    const result = registerSchema.safeParse({
      email: "player@example.com",
      password: "correcthorse1",
      displayName: "Player_One",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a password shorter than 10 characters", () => {
    const result = registerSchema.safeParse({
      email: "player@example.com",
      password: "short1",
      displayName: "Player_One",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no digit", () => {
    const result = registerSchema.safeParse({
      email: "player@example.com",
      password: "nodigitsatall",
      displayName: "Player_One",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a display name shorter than 3 characters", () => {
    const result = registerSchema.safeParse({
      email: "player@example.com",
      password: "correcthorse1",
      displayName: "ab",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a display name longer than 20 characters", () => {
    const result = registerSchema.safeParse({
      email: "player@example.com",
      password: "correcthorse1",
      displayName: "a".repeat(21),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "correcthorse1",
      displayName: "Player_One",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a display name with disallowed characters", () => {
    const result = registerSchema.safeParse({
      email: "player@example.com",
      password: "correcthorse1",
      displayName: "Player<script>",
    });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("defaults rememberMe to false when omitted", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rememberMe).toBe(false);
    }
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("applies the same password policy as registration", () => {
    expect(resetPasswordSchema.safeParse({ password: "short1" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "longenough1" }).success).toBe(true);
  });
});

describe("changePasswordSchema", () => {
  it("requires both current and new password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "oldpassword1",
      newPassword: "newpassword1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing current password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "",
      newPassword: "newpassword1",
    });
    expect(result.success).toBe(false);
  });
});
