// supabase/functions/_payment/types.ts
//
// THE central abstraction of this phase: PaymentProvider. Paystack (this
// phase) is the first implementation; a future Stripe/Flutterwave/Adyen/
// Wise provider implements this exact same interface and nothing in
// deposit-service.ts/withdrawal-service.ts/webhook-service.ts (or WALLET-001/
// ESCROW-001) ever needs to change to support it — only registry.ts's
// provider map gets a new entry.

export interface InitializeTransactionInput {
  amountCents: number;
  currency: string;
  userId: string;
  email: string;
  idempotencyKey: string;
  callbackUrl?: string;
}

export interface InitializeTransactionResult {
  providerRef: string;
  checkoutUrl: string;
  accessCode?: string;
}

export interface VerifyTransactionResult {
  providerRef: string;
  status: "success" | "failed" | "pending";
  amountCents: number;
  currency: string;
  paidAt: string | null;
  channel: string | null;
}

export interface CreateTransferRecipientInput {
  userId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export interface CreateTransferRecipientResult {
  recipientCode: string;
  accountNumberLast4: string;
  resolvedAccountName: string;
}

export interface InitiateTransferInput {
  amountCents: number;
  currency: string;
  recipientCode: string;
  reason: string;
  idempotencyKey: string;
}

export interface InitiateTransferResult {
  providerRef: string;
  status: "pending" | "success" | "failed";
}

export interface TransferStatusResult {
  providerRef: string;
  status: "pending" | "success" | "failed" | "reversed";
  failureReason: string | null;
}

export interface WebhookVerificationResult {
  valid: boolean;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface RefundInput {
  providerRef: string;
  amountCents: number;
  reason: string;
}

export interface RefundResult {
  refundReference: string;
  status: "pending" | "processed" | "failed";
}

/**
 * Every payment provider implements this. No method here is
 * Paystack-specific in signature — Paystack's own request/response shapes
 * are translated to/from these types entirely inside providers/paystack.ts,
 * which is the only file that imports anything Paystack-specific.
 */
export interface PaymentProvider {
  readonly name: string;

  initializeTransaction(
    input: InitializeTransactionInput,
  ): Promise<InitializeTransactionResult>;
  verifyTransaction(providerRef: string): Promise<VerifyTransactionResult>;
  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<WebhookVerificationResult>;

  createTransferRecipient(
    input: CreateTransferRecipientInput,
  ): Promise<CreateTransferRecipientResult>;
  initiateTransfer(
    input: InitiateTransferInput,
  ): Promise<InitiateTransferResult>;
  getTransferStatus(providerRef: string): Promise<TransferStatusResult>;

  /** Architecture-only in this phase — see refund-service.ts's header note
   * on why full refund policy isn't implemented yet. Every provider must
   * still implement the method so the interface is complete and a future
   * phase can wire up the policy without touching this interface again. */
  initiateRefund(input: RefundInput): Promise<RefundResult>;

  lookupTransaction(providerRef: string): Promise<VerifyTransactionResult>;
}
