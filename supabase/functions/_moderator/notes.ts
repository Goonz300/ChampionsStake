// supabase/functions/_moderator/notes.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";

export async function addNote(disputeId: string, authorId: string, content: string): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("dispute_notes")
    .insert({ dispute_id: disputeId, author_id: authorId, content })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to add note: ${error?.message}`);
  return { id: data.id };
}

export async function listNotes(disputeId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("dispute_notes")
    .select("*, profiles(display_name)")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list notes: ${error.message}`);
  return data ?? [];
}
