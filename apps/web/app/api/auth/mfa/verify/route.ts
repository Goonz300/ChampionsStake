import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const mfaVerifySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().length(6),
});

/**
 * POST /api/auth/mfa/verify — see the scope note in enroll/route.ts; this
 * endpoint is plumbing prepared ahead of Phase 6's enforcement, not called
 * anywhere in this phase's own flows.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = mfaVerifySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "factorId and a 6-digit code are required." } },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });

  if (challengeError) {
    return NextResponse.json(
      { error: { code: "AUTH_MFA_REQUIRED", message: challengeError.message } },
      { status: 400 },
    );
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });

  if (verifyError) {
    return NextResponse.json(
      { error: { code: "AUTH_MFA_REQUIRED", message: "Invalid verification code." } },
      { status: 400 },
    );
  }

  return NextResponse.json({ data: { verified: true } });
}
