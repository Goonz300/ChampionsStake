import { z } from "zod";

/**
 * Password policy: minimum 10 characters (Business Rules-derived minimum,
 * matches lib/env's general security posture). Supabase's own project-level
 * minimum password length setting should be configured to match this so the
 * two never silently disagree — see the note in supabase/AUTH-001-deliverable.md.
 */
const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters long.")
  .refine((val) => /[A-Za-z]/.test(val) && /[0-9]/.test(val), {
    message: "Password must contain at least one letter and one number.",
  });

export const registerSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: passwordSchema,
  displayName: z
    .string()
    .min(3, "Display name must be at least 3 characters.")
    .max(20, "Display name must be at most 20 characters.")
    .regex(
      /^[a-zA-Z0-9_\- ]+$/,
      "Display name can only contain letters, numbers, spaces, - and _.",
    ),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  rememberMe: z.boolean().optional().default(false),
  // Layer 9 (CAPTCHA): optional -- only required once the caller's recent
  // failure count crosses CAPTCHA_TRIGGER_AFTER_FAILURES (see
  // lib/security/captcha.ts). Omitted entirely when not yet triggered, so
  // this is fully backward compatible with any client that doesn't send it.
  captchaToken: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
