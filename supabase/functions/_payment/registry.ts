// supabase/functions/_payment/registry.ts
//
// This is what makes "future providers must be pluggable without changing
// Wallet or Escrow" concrete: adding Stripe/Flutterwave/Adyen/Wise later
// means writing providers/stripe.ts implementing PaymentProvider, adding
// one line to PROVIDERS below, and (optionally) flipping the
// active_payment_provider feature flag — nothing in deposit-service.ts,
// withdrawal-service.ts, webhook-service.ts, or any prior phase changes.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import type { PaymentProvider } from "./types.ts";
import { paystackProvider } from "./providers/paystack.ts";

const PROVIDERS: Record<string, PaymentProvider> = {
  paystack: paystackProvider,
};

const DEFAULT_PROVIDER = "paystack";

/**
 * Resolves the active provider. Reads a feature flag (reusing ADMIN-001's
 * existing feature_flags table rather than a new configuration mechanism)
 * so switching providers is an admin action, not a deployment.
 */
export async function getActiveProvider(): Promise<PaymentProvider> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "real_money_enabled")
    .maybeSingle();

  if (data && !data.enabled) {
    throw new Error(
      "Real-money payment processing is currently disabled (real_money_enabled feature flag).",
    );
  }

  const provider = PROVIDERS[DEFAULT_PROVIDER];
  if (!provider) {
    throw new Error(
      `No payment provider registered for key "${DEFAULT_PROVIDER}".`,
    );
  }
  return provider;
}

export function getProviderByName(name: string): PaymentProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown payment provider "${name}".`);
  return provider;
}
