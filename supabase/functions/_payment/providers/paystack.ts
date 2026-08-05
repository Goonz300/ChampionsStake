// supabase/functions/_payment/providers/paystack.ts
//
// The only file in this codebase that knows anything about Paystack's
// actual request/response shapes. Everything it returns is translated into
// the provider-agnostic types from ../types.ts.

import { createHmac } from "node:crypto";
import type {
  CreateTransferRecipientInput,
  CreateTransferRecipientResult,
  InitializeTransactionInput,
  InitializeTransactionResult,
  InitiateTransferInput,
  InitiateTransferResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  TransferStatusResult,
  VerifyTransactionResult,
  WebhookVerificationResult,
} from "../types.ts";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function getSecretKey(): string {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured. Never hardcode a fallback secret.",
    );
  }
  return key;
}

async function paystackRequest<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await response.json();
  if (!response.ok || json.status === false) {
    throw new Error(
      `Paystack API error (${path}): ${json.message ?? response.statusText}`,
    );
  }
  return json.data as T;
}

function mapPaystackStatus(status: string): "success" | "failed" | "pending" {
  if (status === "success") return "success";
  if (status === "failed" || status === "abandoned") return "failed";
  return "pending";
}

export const paystackProvider: PaymentProvider = {
  name: "paystack",

  async initializeTransaction(
    input: InitializeTransactionInput,
  ): Promise<InitializeTransactionResult> {
    const data = await paystackRequest<
      { authorization_url: string; access_code: string; reference: string }
    >(
      "/transaction/initialize",
      "POST",
      {
        email: input.email,
        amount: input.amountCents,
        currency: input.currency,
        reference: input.idempotencyKey,
        callback_url: input.callbackUrl,
        metadata: { user_id: input.userId },
      },
    );

    return {
      providerRef: data.reference,
      checkoutUrl: data.authorization_url,
      accessCode: data.access_code,
    };
  },

  async verifyTransaction(
    providerRef: string,
  ): Promise<VerifyTransactionResult> {
    const data = await paystackRequest<{
      status: string;
      amount: number;
      currency: string;
      paid_at: string | null;
      channel: string | null;
      reference: string;
    }>(`/transaction/verify/${encodeURIComponent(providerRef)}`, "GET");

    return {
      providerRef: data.reference,
      status: mapPaystackStatus(data.status),
      amountCents: data.amount,
      currency: data.currency,
      paidAt: data.paid_at,
      channel: data.channel,
    };
  },

  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<WebhookVerificationResult> {
    if (!signatureHeader) {
      return Promise.resolve({
        valid: false,
        eventId: "",
        eventType: "",
        payload: {},
      });
    }

    const expectedSignature = createHmac("sha512", getSecretKey()).update(
      rawBody,
    ).digest("hex");

    const valid = expectedSignature === signatureHeader;
    if (!valid) {
      return Promise.resolve({
        valid: false,
        eventId: "",
        eventType: "",
        payload: {},
      });
    }

    const payload = JSON.parse(rawBody);
    const eventId: string = payload?.data?.reference ??
      payload?.data?.id?.toString() ?? crypto.randomUUID();

    return Promise.resolve({
      valid: true,
      eventId,
      eventType: payload.event,
      payload,
    });
  },

  async createTransferRecipient(
    input: CreateTransferRecipientInput,
  ): Promise<CreateTransferRecipientResult> {
    const data = await paystackRequest<
      {
        recipient_code: string;
        details: { account_name: string; account_number: string };
      }
    >(
      "/transferrecipient",
      "POST",
      {
        type: "nuban",
        name: input.accountName,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: "NGN",
      },
    );

    return {
      recipientCode: data.recipient_code,
      accountNumberLast4: data.details.account_number.slice(-4),
      resolvedAccountName: data.details.account_name,
    };
  },

  async initiateTransfer(
    input: InitiateTransferInput,
  ): Promise<InitiateTransferResult> {
    const data = await paystackRequest<{ reference: string; status: string }>(
      "/transfer",
      "POST",
      {
        source: "balance",
        amount: input.amountCents,
        recipient: input.recipientCode,
        reason: input.reason,
        reference: input.idempotencyKey,
      },
    );

    return {
      providerRef: data.reference,
      status: mapPaystackStatus(data.status) === "success"
        ? "success"
        : "pending",
    };
  },

  async getTransferStatus(providerRef: string): Promise<TransferStatusResult> {
    const data = await paystackRequest<
      { status: string; reason: string | null }
    >(
      `/transfer/${encodeURIComponent(providerRef)}`,
      "GET",
    );

    const status = data.status === "success"
      ? "success"
      : data.status === "failed"
      ? "failed"
      : data.status === "reversed"
      ? "reversed"
      : "pending";

    return { providerRef, status, failureReason: data.reason };
  },

  /** Architecture-only — see the PaymentProvider interface note and
   * refund-service.ts's header comment. Implemented against Paystack's real
   * /refund endpoint (not a stub), but not yet wired to any business
   * decision about WHEN a refund should be initiated. */
  async initiateRefund(input: RefundInput): Promise<RefundResult> {
    const data = await paystackRequest<{ status: string; id: number }>(
      "/refund",
      "POST",
      {
        transaction: input.providerRef,
        amount: input.amountCents,
        customer_note: input.reason,
      },
    );

    return {
      refundReference: data.id.toString(),
      status: data.status === "processed"
        ? "processed"
        : data.status === "failed"
        ? "failed"
        : "pending",
    };
  },

  lookupTransaction(providerRef: string): Promise<VerifyTransactionResult> {
    return paystackProvider.verifyTransaction(providerRef);
  },
};
