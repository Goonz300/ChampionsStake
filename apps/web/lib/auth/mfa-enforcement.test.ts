import { describe, expect, it } from "vitest";
import { checkAal2Required } from "./mfa-enforcement";

function makeSupabase(opts: {
  totpFactors?: { status: string }[];
  factorsError?: Error | null;
  currentLevel?: "aal1" | "aal2" | null;
  aalError?: Error | null;
}) {
  return {
    auth: {
      mfa: {
        listFactors: async () => ({
          data: opts.factorsError
            ? null
            : { all: opts.totpFactors ?? [], totp: opts.totpFactors ?? [], phone: [] },
          error: opts.factorsError ?? null,
        }),
        getAuthenticatorAssuranceLevel: async () => ({
          data: opts.aalError
            ? null
            : {
                currentLevel: opts.currentLevel ?? "aal1",
                nextLevel: "aal2",
                currentAuthenticationMethods: [],
              },
          error: opts.aalError ?? null,
        }),
      },
    },
  } as never;
}

describe("checkAal2Required", () => {
  it("is satisfied without checking AAL at all when the user has no enrolled TOTP factor", async () => {
    const supabase = makeSupabase({ totpFactors: [] });

    const result = await checkAal2Required(supabase);

    expect(result).toEqual({ satisfied: true, hasMfaEnrolled: false, error: null });
  });

  it("is satisfied when MFA is enrolled and the session is already aal2", async () => {
    const supabase = makeSupabase({
      totpFactors: [{ status: "verified" }],
      currentLevel: "aal2",
    });

    const result = await checkAal2Required(supabase);

    expect(result).toEqual({ satisfied: true, hasMfaEnrolled: true, error: null });
  });

  it("is NOT satisfied when MFA is enrolled but the session is only aal1", async () => {
    const supabase = makeSupabase({
      totpFactors: [{ status: "verified" }],
      currentLevel: "aal1",
    });

    const result = await checkAal2Required(supabase);

    expect(result).toEqual({ satisfied: false, hasMfaEnrolled: true, error: null });
  });

  it("propagates a listFactors error rather than silently treating it as satisfied", async () => {
    const factorsError = new Error("network down");
    const supabase = makeSupabase({ factorsError });

    const result = await checkAal2Required(supabase);

    expect(result.satisfied).toBe(false);
    expect(result.error).toBe(factorsError);
  });

  it("propagates a getAuthenticatorAssuranceLevel error rather than silently treating it as satisfied", async () => {
    const aalError = new Error("network down");
    const supabase = makeSupabase({ totpFactors: [{ status: "verified" }], aalError });

    const result = await checkAal2Required(supabase);

    expect(result.satisfied).toBe(false);
    expect(result.hasMfaEnrolled).toBe(true);
    expect(result.error).toBe(aalError);
  });
});
