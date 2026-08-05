// supabase/functions/_admin/announcements.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { NotFoundError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";

export interface CreateAnnouncementInput {
  category: "platform_notice" | "maintenance" | "tournament" | "emergency";
  title: string;
  body: string;
  expiresAt?: string;
}

export async function createAnnouncement(
  input: CreateAnnouncementInput,
  adminId: string,
): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("announcements")
    .insert({
      category: input.category,
      title: input.title,
      body: input.body,
      expires_at: input.expiresAt,
      created_by: adminId,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create announcement: ${error?.message}`);
  }

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "AnnouncementCreated",
    category: "admin",
    targetTable: "announcements",
    targetId: data.id,
  });

  return { id: data.id };
}

export async function publishAnnouncement(
  announcementId: string,
  adminId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("announcements")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", announcementId);
  if (error) {
    throw new Error(`Failed to publish announcement: ${error.message}`);
  }

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "AnnouncementPublished",
    category: "admin",
    targetTable: "announcements",
    targetId: announcementId,
  });
}

export async function retractAnnouncement(
  announcementId: string,
  adminId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("announcements")
    .update({ status: "retracted" })
    .eq("id", announcementId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to retract announcement: ${error.message}`);
  }
  if (!data) {
    throw new NotFoundError(`Announcement ${announcementId} not found.`);
  }

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "AnnouncementRetracted",
    category: "admin",
    targetTable: "announcements",
    targetId: announcementId,
  });
}

export async function listAnnouncements(status?: string) {
  const supabase = getServiceRoleClient();
  let query = supabase.from("announcements").select("*").order("created_at", {
    ascending: false,
  });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list announcements: ${error.message}`);
  return data ?? [];
}
