// supabase/functions/_wallet/ledger.test.ts
//
// Tests the parts of postBalancedEntries that are pure logic (the
// debit/credit balance check happens BEFORE any database connection is
// opened) — this is deliberately the boundary: everything past that point
// needs a live Postgres connection (row locking, the deferred constraint
// trigger, actual balance reads) and is a documented integration-test gap,
// not silently skipped. See WALLET-001-deliverable.md's Tests section.

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { postBalancedEntries } from "./ledger.ts";
import { WalletError } from "../_shared/errors/index.ts";
import type { TransferRequest } from "./types.ts";

Deno.test("postBalancedEntries rejects an empty legs array", async () => {
  const request: TransferRequest = {
    type: "adjustment",
    legs: [],
    initiatedBy: null,
  };
  await assertRejects(
    () => postBalancedEntries(request),
    WalletError,
    "at least one ledger leg",
  );
});

Deno.test("postBalancedEntries rejects unbalanced debits and credits", async () => {
  const request: TransferRequest = {
    type: "adjustment",
    legs: [
      {
        walletId: "11111111-1111-1111-1111-111111111111",
        accountType: "available",
        direction: "debit",
        amountCents: 1000,
      },
      {
        walletId: "22222222-2222-2222-2222-222222222222",
        accountType: "available",
        direction: "credit",
        amountCents: 500,
      },
    ],
    initiatedBy: null,
  };

  await assertRejects(
    () => postBalancedEntries(request),
    WalletError,
    "Unbalanced ledger request",
  );
});

Deno.test("postBalancedEntries's balance check passes for genuinely balanced legs (fails later at the DB connection step, which is expected in this offline test environment)", async () => {
  const request: TransferRequest = {
    type: "adjustment",
    legs: [
      {
        walletId: "11111111-1111-1111-1111-111111111111",
        accountType: "available",
        direction: "debit",
        amountCents: 1000,
      },
      {
        walletId: "22222222-2222-2222-2222-222222222222",
        accountType: "available",
        direction: "credit",
        amountCents: 1000,
      },
    ],
    initiatedBy: null,
  };

  // No live Postgres connection exists in this test environment, so this
  // will throw when it tries to actually open a transaction — but critically
  // it must NOT throw WalletError, since that would mean the (correct)
  // balance check incorrectly rejected valid, balanced legs.
  await assertRejects(
    () => postBalancedEntries(request),
    Error,
    undefined,
    "expected a connection-level failure, not a WalletError from the balance check",
  );

  try {
    await postBalancedEntries(request);
  } catch (err) {
    assertEquals(err instanceof WalletError, false);
  }
});

Deno.test("a three-leg balanced transfer (escrow release + fee split) passes the balance check", async () => {
  // Mirrors releaseFromEscrow's shape: escrowed debit = available credit + fee credit.
  const request: TransferRequest = {
    type: "payout",
    legs: [
      {
        walletId: "11111111-1111-1111-1111-111111111111",
        accountType: "escrowed",
        direction: "debit",
        amountCents: 1000,
      },
      {
        walletId: "22222222-2222-2222-2222-222222222222",
        accountType: "available",
        direction: "credit",
        amountCents: 925,
      },
      {
        walletId: null,
        accountType: "platform_fee_revenue",
        direction: "credit",
        amountCents: 75,
      },
    ],
    initiatedBy: null,
  };

  try {
    await postBalancedEntries(request);
  } catch (err) {
    assertEquals(
      err instanceof WalletError,
      false,
      "a correctly-balanced 3-leg transfer must not be rejected as unbalanced",
    );
  }
});
