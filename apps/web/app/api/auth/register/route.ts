import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { registerSchema } from "@/lib/auth/validation";

/**
 * POST /api/auth/register
 * Business Rules §2: account is created 'unverified'; the identity-sync
 * trigger (migration 0029) creates the profile/wallet/preferences rows
 * automatically the instant Supabase Auth inserts into auth.users — this
 * route does not duplicate that logic, it only validates input and calls
 * supabase.auth.signUp().
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

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

  const { email, password, displayName } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${new URL(request.url).origin}/auth/callback?next=/verify-email`,
    },
  });

  if (error) {
    const isDuplicate = error.message.toLowerCase().includes("already registered");
    return NextResponse.json(
      {
        error: {
          code: isDuplicate ? "AUTH_EMAIL_ALREADY_EXISTS" : "VALIDATION_ERROR",
          message: isDuplicate ? "An account with this email already exists." : error.message,
        },
      },
      { status: isDuplicate ? 409 : 400 },
    );
  }

  return NextResponse.json(
    { data: { user_id: data.user?.id, status: "unverified" } },
    { status: 201 },
  );
}
