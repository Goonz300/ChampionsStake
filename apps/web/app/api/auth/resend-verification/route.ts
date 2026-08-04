import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema as emailOnlySchema } from "@/lib/auth/validation";

/**
 * POST /api/auth/resend-verification
 * Business Rules §2: resend is rate-limited to 1 per 5 minutes. Reuses
 * Supabase Auth's own resend rate limiting rather than re-implementing it,
 * since GoTrue already enforces a cooldown on resend requests per project
 * configuration.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = emailOnlySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "A valid email is required." } },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const origin = new URL(request.url).origin;

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/verify-email` },
  });

  if (error && error.status !== 429) {
    // Still don't reveal account existence for non-rate-limit errors.
    return NextResponse.json({ data: { sent: true } });
  }

  if (error?.status === 429) {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_EXCEEDED", message: "Please wait before requesting another email." } },
      { status: 429 },
    );
  }

  return NextResponse.json({ data: { sent: true } });
}
