import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema } from "@/lib/auth/validation";

/**
 * POST /api/auth/forgot-password
 * Always returns 200 regardless of whether the account exists, to avoid
 * user enumeration (API Spec AUTH-EP-06).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid input.",
        },
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const origin = new URL(request.url).origin;

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  // Deliberately ignore the error/result — never reveal whether the email
  // exists in the system.

  return NextResponse.json({ data: { sent: true } });
}
