// supabase/functions/_moderator/notes.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { assertModeratorOnDispute } from "./cases.ts";

/**
 * Phase 3D independent-review finding: unlike decisions.ts/queue.ts/
 * appeals.ts (this module's siblings in _moderator/), adding a note had no
 * audit trail. Notes themselves stay private (never visible to players,
 * per MODERATOR-001's own design) -- this only records that a note was
 * added and by whom, not its content, consistent with how other audit
 * entries in this codebase avoid duplicating sensitive content into
 * metadata unless the action itself is the sensitive part.
 */
export async function addNote(
  disputeId: string,
  authorId: string,
  content: string,
  isAdmin: boolean,
): Promise<{ id: string }> {
  await assertModeratorOnDispute(disputeId, authorId, isAdmin);
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("dispute_notes")
    .insert({ dispute_id: disputeId, author_id: authorId, content })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to add note: ${error?.message}`);

  await recordAudit({
    actorId: authorId,
    actorType: "moderator",
    action: "ModeratorNoteAdded",
    category: "moderation",
    targetTable: "dispute_notes",
    targetId: data.id,
    metadata: { dispute_id: disputeId },
  });

  return { id: data.id };
}

export async function listNotes(
  disputeId: string,
  moderatorId: string,
  isAdmin: boolean,
) {
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("dispute_notes")
    .select("*, profiles(display_name)")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list notes: ${error.message}`);
  return data ?? [];
}
