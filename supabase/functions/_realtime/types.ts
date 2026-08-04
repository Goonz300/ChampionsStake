// supabase/functions/_realtime/types.ts

export type ChatMessageType = "text" | "image" | "video" | "voice" | "system";

export interface ChatMessage {
  id: string;
  challengeId: string;
  senderId: string | null;
  type: ChatMessageType;
  content: string | null;
  mediaUrl: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export type NotificationCategory =
  | "challenge"
  | "tournament"
  | "wallet"
  | "escrow"
  | "moderator"
  | "system"
  | "security"
  | "friends"
  | "platform"
  | "announcements";

export type PresenceStatus = "online" | "offline" | "away" | "in_match" | "ready";
