// supabase/functions/_realtime/chat.ts
//
// MEDIA REUSE NOTE: this file never uploads bytes itself. STORE-001's
// upload pipeline (validation, authorization, checksum, file_uploads
// bookkeeping) already lives in the Next.js app (lib/storage/service.ts) —
// a different runtime (Node) than these Deno Edge Functions, so it can't
// be imported directly. Media chat messages are therefore a two-step flow:
// (1) the client uploads via the existing `POST /api/storage/upload`
// (bucket 'chat-media' or 'voice-notes', related={table:'challenges',
// id:challengeId}) — unchanged, no duplicate validation logic anywhere in
// this file; (2) the client calls chat-send with the resulting
// file_upload_id, and THIS file only verifies that upload row exists, is
// 'active', belongs to the right bucket/challenge, and was uploaded by the
// sender, before creating the chat message. Generating a signed URL for
// display is a single trivial Supabase Storage SDK call
// (storage.createSignedUrl) — that's calling the same underlying API
// STORE-001 calls, not reimplementing its validation/authorization logic.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { isParticipant } from "../_challenge/repository.ts";

const EDIT_WINDOW_MINUTES = 5;

export interface SendMessageInput {
  challengeId: string;
  senderId: string;
  type: "text" | "image" | "video" | "voice";
  content?: string;
  fileUploadId?: string; // required for image/video/voice
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<{ id: string }> {
  if (!(await isParticipant(input.challengeId, input.senderId))) {
    throw new AuthorizationError(
      "Only challenge participants may send chat messages.",
    );
  }

  const supabase = getServiceRoleClient();
  let mediaPath: string | null = null;
  let bucket: string | null = null;

  if (input.type !== "text") {
    if (!input.fileUploadId) {
      throw new ValidationError(
        `fileUploadId is required for a "${input.type}" message.`,
      );
    }
    const { data: upload, error } = await supabase
      .from("file_uploads")
      .select("*")
      .eq("id", input.fileUploadId)
      .maybeSingle();

    if (error || !upload) {
      throw new NotFoundError("Referenced file upload not found.");
    }
    if (upload.owner_id !== input.senderId) {
      throw new AuthorizationError("You may only attach your own uploads.");
    }
    if (upload.status !== "active") {
      throw new ConflictError(
        "This upload is not yet available (still processing or quarantined).",
      );
    }
    if (!["chat-media", "voice-notes"].includes(upload.bucket)) {
      throw new ValidationError(
        `Bucket "${upload.bucket}" is not valid for chat attachments.`,
      );
    }
    if (
      upload.related_table !== "challenges" ||
      upload.related_id !== input.challengeId
    ) {
      throw new ValidationError("This upload was not made for this challenge.");
    }

    mediaPath = upload.storage_path;
    bucket = upload.bucket;
  }

  // The read-only-after-terminal-state rule and content/media presence
  // check are both enforced by DB-001's fn_challenge_messages_read_only_guard
  // trigger — this INSERT relies on that, not a duplicate check here.
  const { data: message, error: insertError } = await supabase
    .from("challenge_messages")
    .insert({
      challenge_id: input.challengeId,
      sender_id: input.senderId,
      type: input.type,
      content: input.content ?? null,
      media_url: mediaPath, // storage path, not a signed URL — signed at read time, see getMessages
    })
    .select("id")
    .single();

  if (insertError || !message) {
    throw new Error(`Failed to send message: ${insertError?.message}`);
  }

  await recordAudit({
    actorId: input.senderId,
    actorType: "user",
    action: "MessageSent",
    category: "system",
    targetTable: "challenge_messages",
    targetId: message.id,
    metadata: { challenge_id: input.challengeId, type: input.type, bucket },
  });

  await emit({
    type: "NotificationQueued",
    payload: {
      reason: "chat_message",
      challengeId: input.challengeId,
      messageId: message.id,
      senderId: input.senderId,
    },
    emittedBy: "chat-send",
  });

  return { id: message.id };
}

/** System messages (challenge state changes, escrow updates, moderator
 * notices) — sender_id is null, bypassing participant checks since the
 * system is always allowed to post. */
export async function sendSystemMessage(
  challengeId: string,
  content: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase.from("challenge_messages").insert({
    challenge_id: challengeId,
    sender_id: null,
    type: "system",
    content,
  });
}

export async function editMessage(
  messageId: string,
  senderId: string,
  newContent: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: message, error } = await supabase.from("challenge_messages")
    .select("*").eq("id", messageId).maybeSingle();
  if (error || !message) throw new NotFoundError("Message not found.");

  if (message.sender_id !== senderId) {
    throw new AuthorizationError("Only the sender may edit this message.");
  }

  const ageMinutes = (Date.now() - new Date(message.created_at).getTime()) /
    60000;
  if (ageMinutes > EDIT_WINDOW_MINUTES) {
    throw new ConflictError(
      `The ${EDIT_WINDOW_MINUTES}-minute edit window for this message has passed.`,
    );
  }

  const { error: updateError } = await supabase
    .from("challenge_messages")
    .update({
      content: newContent,
      edited_at: new Date().toISOString(),
      original_content: message.original_content ?? message.content,
    })
    .eq("id", messageId);

  // fn_messages_seen_by_only_guard (migration 0049) enforces the same
  // window/sender/terminal-state rules again at the database layer —
  // this is defense-in-depth, not the sole check.
  if (updateError) {
    throw new Error(`Failed to edit message: ${updateError.message}`);
  }

  await recordAudit({
    actorId: senderId,
    actorType: "user",
    action: "MessageEdited",
    category: "system",
    targetTable: "challenge_messages",
    targetId: messageId,
  });
}

export async function deleteMessage(
  messageId: string,
  senderId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: message, error } = await supabase.from("challenge_messages")
    .select("*").eq("id", messageId).maybeSingle();
  if (error || !message) throw new NotFoundError("Message not found.");

  if (message.sender_id !== senderId) {
    throw new AuthorizationError("Only the sender may delete this message.");
  }

  const { error: updateError } = await supabase
    .from("challenge_messages")
    .update({
      content: null,
      media_url: null,
      deleted_at: new Date().toISOString(),
      original_content: message.original_content ?? message.content,
    })
    .eq("id", messageId);

  if (updateError) {
    throw new Error(`Failed to delete message: ${updateError.message}`);
  }

  await recordAudit({
    actorId: senderId,
    actorType: "user",
    action: "MessageDeleted",
    category: "system",
    targetTable: "challenge_messages",
    targetId: messageId,
  });
}

/** Fetches messages, resolving media_url storage paths into short-lived
 * signed URLs at read time (never stores a signed URL, which would go
 * stale). Deletes are shown as tombstones (no content/media). */
export async function getMessages(
  challengeId: string,
  callerId: string,
  cursor?: string,
  limit = 50,
) {
  if (!(await isParticipant(challengeId, callerId))) {
    throw new AuthorizationError(
      "Only challenge participants may view this chat.",
    );
  }

  const supabase = getServiceRoleClient();
  let query = supabase
    .from("challenge_messages")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);

  const resolved = [];
  for (const row of data ?? []) {
    let mediaUrl = row.media_url;
    if (mediaUrl && row.type !== "text" && !row.deleted_at) {
      const bucket = row.type === "voice" ? "voice-notes" : "chat-media";
      const { data: signed } = await supabase.storage.from(bucket)
        .createSignedUrl(mediaUrl, 3600);
      mediaUrl = signed?.signedUrl ?? null;
    }
    resolved.push({ ...row, media_url: row.deleted_at ? null : mediaUrl });
  }

  return resolved;
}

export async function markDelivered(
  messageId: string,
  userId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase
    .from("message_receipts")
    .upsert({
      message_id: messageId,
      user_id: userId,
      delivered_at: new Date().toISOString(),
    }, { onConflict: "message_id,user_id" });
}

export async function markSeen(
  challengeId: string,
  userId: string,
  upToMessageId: string,
): Promise<void> {
  if (!(await isParticipant(challengeId, userId))) {
    throw new AuthorizationError(
      "Only challenge participants may mark messages seen.",
    );
  }

  const supabase = getServiceRoleClient();
  const { data: upToMessage } = await supabase.from("challenge_messages")
    .select("created_at").eq("id", upToMessageId).single();
  if (!upToMessage) throw new NotFoundError("Message not found.");

  const { data: messages } = await supabase
    .from("challenge_messages")
    .select("id, seen_by")
    .eq("challenge_id", challengeId)
    .lte("created_at", upToMessage.created_at);

  const now = new Date().toISOString();
  for (const msg of messages ?? []) {
    if (!msg.seen_by.includes(userId)) {
      await supabase
        .from("challenge_messages")
        .update({ seen_by: [...msg.seen_by, userId] })
        .eq("id", msg.id);
    }
    await supabase
      .from("message_receipts")
      .upsert({ message_id: msg.id, user_id: userId, seen_at: now }, {
        onConflict: "message_id,user_id",
      });
  }
}
