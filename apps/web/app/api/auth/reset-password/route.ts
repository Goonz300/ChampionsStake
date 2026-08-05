import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/lib/auth/validation";

/**
 * POST /api/auth/reset-password
 * Called after the user has followed the emailed reset link and landed on
 * /reset-password with a valid recovery session already established by
 * /auth/callback (Supabase exchanges the recovery code for a short-lived
 * session before this page ever renders — see app/auth/callback/route.ts).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input." } },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_TOKEN_EXPIRED",
          message: "Your password reset link has expired. Request a new one.",
        },
      },
      { status: 410 },
    );
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ data: { reset: true } });
}
