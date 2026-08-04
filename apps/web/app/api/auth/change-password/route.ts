import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { changePasswordSchema } from "@/lib/auth/validation";

/**
 * POST /api/auth/change-password — for an already-authenticated user
 * changing their password from Settings, as opposed to the forgot/reset
 * flow. Re-verifies the current password before allowing the change, since
 * a valid session alone shouldn't be sufficient to silently change the
 * password on an account someone else is briefly logged into (e.g. a shared
 * device).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);

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

  if (!user?.email) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
      { status: 401 },
    );
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (verifyError) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Current password is incorrect." } },
      { status: 401 },
    );
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });

  if (error) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ data: { changed: true } });
}
