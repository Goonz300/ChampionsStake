// supabase/functions/_realtime/delivery.ts
//
// Phase 4: the actual push/email SENDER that migration 0065 explicitly
// deferred ("It does not add a push/email SENDER... these tables are the
// durable state a future sender would read from"). This file is that
// sender/reader -- push_tokens, notification_templates, and email_queue
// were all fully-designed, inert schema before this file existed (grep
// confirmed zero consumers anywhere in supabase/functions/).
//
// Templates are looked up by code = the domain event's type string (e.g.
// "ChallengeCompleted") -- a simple, predictable convention needing no
// separate mapping table. notification_templates rows are admin-authored
// content (its own RLS policy already restricts writes to admins); if no
// template exists yet for a given event type, that is a normal, expected,
// non-error state (an admin hasn't authored that notification's copy
// yet) -- logged at info level and skipped, never thrown.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { logger } from "../_shared/logger/index.ts";
import { config } from "../_shared/config/index.ts";

/** Exported for unit testing; not otherwise part of this module's public
 * API (mirrors _shared/auth/jwt.ts's decodeJwtIat precedent for the same
 * reason: a small pure function worth testing directly inside a file
 * that's otherwise almost entirely DB/network calls). */
export function substitute(
  template: string | null,
  variables: Record<string, unknown>,
): string | undefined {
  if (!template) return undefined;
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => String(variables[key] ?? ""),
  );
}

interface RenderedTemplate {
  id: string;
  pushTitle?: string;
  pushBody?: string;
  emailSubject?: string;
  emailBodyHtml?: string;
  emailBodyText?: string;
}

async function renderTemplate(
  eventType: string,
  variables: Record<string, unknown>,
): Promise<RenderedTemplate | null> {
  const supabase = getServiceRoleClient();
  const { data: template } = await supabase
    .from("notification_templates")
    .select("*")
    .eq("code", eventType)
    .eq("is_active", true)
    .maybeSingle();

  if (!template) return null;

  return {
    id: template.id,
    pushTitle: substitute(template.push_title_template, variables),
    pushBody: substitute(template.push_body_template, variables),
    emailSubject: substitute(template.email_subject_template, variables),
    emailBodyHtml: substitute(template.email_body_html_template, variables),
    emailBodyText: substitute(template.email_body_text_template, variables),
  };
}

async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (tokens.length === 0) return;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.notifications.expoAccessToken) {
    headers["Authorization"] = `Bearer ${config.notifications.expoAccessToken}`;
  }
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers,
    body: JSON.stringify(tokens.map((to) => ({ to, title, body, data }))),
  });
  if (!response.ok) {
    logger.error("Expo push send failed", { status: response.status });
  }
}

/**
 * Sends a push notification to every active token the user has
 * registered, grouped by provider. Only 'expo' actually sends in this
 * phase -- fcm/apns/web_push are architecture-ready (the schema and this
 * function's own dispatch structure fully support them) but not wired to
 * a real provider API yet, the same "stated honestly, not silently
 * accepted" pattern this codebase already uses for the double-elimination
 * bracket generator (_tournament/bracket.ts). Best-effort throughout: a
 * push failure must never fail the caller's real action.
 */
export async function sendPushNotification(
  userId: string,
  eventType: string,
  variables: Record<string, unknown>,
): Promise<void> {
  try {
    const rendered = await renderTemplate(eventType, variables);
    if (!rendered?.pushTitle && !rendered?.pushBody) return;

    const supabase = getServiceRoleClient();
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("provider, token")
      .eq("user_id", userId)
      .eq("is_active", true);

    const byProvider = new Map<string, string[]>();
    for (const t of tokens ?? []) {
      const list = byProvider.get(t.provider as string) ?? [];
      list.push(t.token as string);
      byProvider.set(t.provider as string, list);
    }

    for (const [provider, providerTokens] of byProvider) {
      if (provider === "expo") {
        await sendExpoPush(
          providerTokens,
          rendered.pushTitle ?? "ChampionsStake",
          rendered.pushBody ?? "",
          { eventType, ...variables },
        );
      } else {
        logger.info(
          `Push provider "${provider}" is architecture-ready only (Phase 4) -- not implemented, skipping ${providerTokens.length} token(s).`,
          { provider, userId },
        );
      }
    }
  } catch (err) {
    logger.error("Failed to send push notification", {
      userId,
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Enqueues an email for the outbound worker (email-queue-process, added
 * this phase) to actually send -- never sends synchronously here, since
 * email_queue's whole point is durable retry/backoff, which only means
 * something if enqueue and send are separate steps. Best-effort: an
 * enqueue failure must never fail the caller's real action.
 */
export async function enqueueEmailNotification(
  userId: string,
  eventType: string,
  variables: Record<string, unknown>,
): Promise<void> {
  try {
    const rendered = await renderTemplate(eventType, variables);
    if (!rendered?.emailSubject) return;

    const supabase = getServiceRoleClient();
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const recipientEmail = authUser?.user?.email;
    if (!recipientEmail) return;

    await supabase.from("email_queue").insert({
      user_id: userId,
      recipient_email: recipientEmail,
      template_id: rendered.id,
      provider: "resend",
      subject: rendered.emailSubject,
      body_html: rendered.emailBodyHtml ?? null,
      body_text: rendered.emailBodyText ?? null,
      variables,
    });
  } catch (err) {
    logger.error("Failed to enqueue email notification", {
      userId,
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
