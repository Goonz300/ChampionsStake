// supabase/functions/_realtime/email-worker.ts
//
// Phase 4: consumes email_queue (migration 0065), which was schema-only
// before this file existed -- retry_count/max_retries/next_retry_at/
// last_error/provider_message_id all existed but nothing ever read or
// wrote them. This is that consumer, using the EXACT existing columns --
// no schema change was needed for retries or dead-letter handling, only
// code that actually uses what was already there.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { logger } from "../_shared/logger/index.ts";
import { config } from "../_shared/config/index.ts";

interface EmailQueueRow {
  id: string;
  recipient_email: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
}

const MAX_BACKOFF_MINUTES = 60;

async function sendViaResend(
  row: EmailQueueRow,
): Promise<
  { success: true; messageId: string | null } | {
    success: false;
    error: string;
  }
> {
  if (!config.notifications.resendApiKey) {
    return { success: false, error: "RESEND_API_KEY is not configured." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.notifications.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.notifications.resendFromAddress,
      to: row.recipient_email,
      subject: row.subject,
      html: row.body_html ?? undefined,
      text: row.body_text ?? undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    return {
      success: false,
      error: `Resend returned ${response.status}: ${errorText}`,
    };
  }

  const body = await response.json().catch(() => null) as
    | { id?: string }
    | null;
  return { success: true, messageId: body?.id ?? null };
}

/**
 * Processes queued (and retry-due failed) emails, up to `limit` rows per
 * run. A 'failed' row with retry_count >= max_retries is a dead letter --
 * permanently excluded from further attempts, queryable as such by that
 * exact condition (no separate dead-letter table needed; the existing
 * columns already express it). Exponential backoff (2^attempt minutes,
 * capped at 60) between retries.
 *
 * Known, deliberate simplification: candidates are fetched by status
 * alone (queued or failed), then dead-lettered/not-yet-due rows are
 * filtered out in application code, since PostgREST cannot compare two
 * columns of the same row (retry_count < max_retries) in a single filter
 * expression. A large dead-letter backlog could theoretically crowd out
 * genuinely processable rows within one `limit`-sized page; acceptable
 * for this phase's scope, not expected to matter until email volume is
 * large enough to warrant a dedicated index/query redesign.
 */
export async function processEmailQueue(
  limit = 50,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const supabase = getServiceRoleClient();
  const now = Date.now();

  const { data: candidates, error } = await supabase
    .from("email_queue")
    .select("*")
    .in("status", ["queued", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch email queue: ${error.message}`);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of (candidates ?? []) as EmailQueueRow[]) {
    if (row.status === "failed") {
      if (row.retry_count >= row.max_retries) {
        skipped += 1;
        continue;
      }
      if (row.next_retry_at && new Date(row.next_retry_at).getTime() > now) {
        skipped += 1;
        continue;
      }
    }

    // Phase 4 independent-review finding: overlapping cron invocations
    // (the job runs long enough to still be mid-batch when the next
    // minute's trigger fires) could otherwise both select the same
    // 'queued'/'failed' row and send it twice. This is the same atomic
    // UPDATE ... WHERE ... RETURNING claim pattern already established in
    // this codebase (recovery-codes.ts's consumeRecoveryCode, Phase 3C) --
    // only the invocation that actually flips the row to 'processing'
    // (guarded by re-checking its status hasn't changed since the SELECT
    // above) proceeds to send; a second, racing invocation gets back no
    // row and skips it.
    const { data: claimed } = await supabase
      .from("email_queue")
      .update({ status: "processing" })
      .eq("id", row.id)
      .in("status", ["queued", "failed"])
      .select("id")
      .maybeSingle();

    if (!claimed) {
      skipped += 1;
      continue;
    }

    const result = await sendViaResend(row);

    if (result.success) {
      await supabase.from("email_queue").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: result.messageId,
      }).eq("id", row.id);
      sent += 1;
    } else {
      const newRetryCount = row.retry_count + 1;
      const backoffMinutes = Math.min(
        MAX_BACKOFF_MINUTES,
        2 ** newRetryCount,
      );
      await supabase.from("email_queue").update({
        status: "failed",
        retry_count: newRetryCount,
        next_retry_at: new Date(now + backoffMinutes * 60_000).toISOString(),
        last_error: result.error,
      }).eq("id", row.id);
      failed += 1;
      logger.error("Failed to send queued email", {
        emailQueueId: row.id,
        retryCount: newRetryCount,
        deadLettered: newRetryCount >= row.max_retries,
        error: result.error,
      });
    }
  }

  return { sent, failed, skipped };
}
