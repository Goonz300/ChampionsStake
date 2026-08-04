import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/mfa/enroll
 *
 * SCOPE NOTE: this wires up Supabase Auth's native TOTP MFA support so the
 * mechanism exists, per this phase's Step 10 ("prepare architecture for
 * MFA... do not require MFA unless defined by the approved business
 * rules"). Business Rules §2 ties MFA *enforcement* to the withdrawal
 * threshold, which doesn't exist until the Wallet engine (Roadmap Phase 6,
 * AUTH-006) is built — so nothing in this phase calls or requires this
 * endpoint. It's here so Phase 6 can enforce it without also having to
 * build the enrollment plumbing at that point.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
      { status: 401 },
    );
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      factor_id: data.id,
      secret: data.totp.secret,
      qr_url: data.totp.qr_code,
    },
  });
}
