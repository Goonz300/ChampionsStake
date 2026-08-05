/**
 * Supabase Database types.
 *
 * IMPORTANT: this file is hand-written and intentionally covers only the
 * tables the Authentication phase touches (profiles, wallets,
 * user_preferences). It is NOT a substitute for real generated types.
 *
 * Once a live Supabase project exists, replace this entire file with:
 *   supabase gen types typescript --project-id <ref> > lib/supabase/types.ts
 * (or --local, against a locally running instance). Every other table from
 * DB-001/DB-002 (challenges, wallet_ledger, disputes, etc.) will need real
 * generated types before the phases that use them are implemented — do not
 * hand-extend this file for those; regenerate it instead, so it never drifts
 * from the actual schema.
 */

export type UserRole = "player" | "moderator" | "administrator" | "support";
export type UserStatus = "unverified" | "active" | "suspended" | "closed";
export type KycStatus = "unverified" | "pending" | "verified" | "rejected";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          role: UserRole;
          status: UserStatus;
          kyc_status: KycStatus;
          kyc_provider_ref: string | null;
          trust_score: number;
          completion_rate: number;
          country_code: string | null;
          email_verified_at: string | null;
          suspended_at: string | null;
          suspended_reason_code: string | null;
          closed_at: string | null;
          sessions_invalidated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          display_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
      };
      wallets: {
        Row: {
          id: string;
          user_id: string;
          status: "active" | "frozen";
          currency: string;
          available_cents: number;
          escrowed_cents: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["wallets"]["Row"]> & {
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["wallets"]["Row"]>;
      };
      user_preferences: {
        Row: {
          id: string;
          user_id: string;
          notification_preferences: Record<string, unknown>;
          privacy_preferences: Record<string, unknown>;
          gaming_preferences: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["user_preferences"]["Row"]> & {
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_preferences"]["Row"]>;
      };
      devices: {
        Row: {
          id: string;
          user_id: string;
          device_fingerprint: string;
          platform: string | null;
          first_seen_at: string;
          last_seen_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["devices"]["Row"]> & {
          user_id: string;
          device_fingerprint: string;
        };
        Update: Partial<Database["public"]["Tables"]["devices"]["Row"]>;
      };
      user_sessions: {
        Row: {
          id: string;
          user_id: string;
          refresh_token_hash: string;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
          expires_at: string;
          revoked_at: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["user_sessions"]["Row"]> & {
          user_id: string;
          refresh_token_hash: string;
          expires_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_sessions"]["Row"]>;
      };
      feature_flags: {
        Row: {
          key: string;
          description: string;
          enabled: boolean;
          requires_dual_approval: boolean;
          pending_approval_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["feature_flags"]["Row"]> & {
          key: string;
          description: string;
        };
        Update: Partial<Database["public"]["Tables"]["feature_flags"]["Row"]>;
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_type: "user" | "moderator" | "administrator" | "system";
          action: string;
          category: string;
          target_table: string;
          target_id: string;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]> & {
          actor_type: "user" | "moderator" | "administrator" | "system";
          action: string;
          category: string;
          target_table: string;
          target_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]>;
      };
      file_uploads: {
        Row: {
          id: string;
          owner_id: string;
          bucket: string;
          storage_path: string;
          mime_type: string;
          file_size_bytes: number;
          checksum_sha256: string;
          related_table: string | null;
          related_id: string | null;
          visibility: "public" | "private";
          status: "pending" | "active" | "quarantined" | "deleted";
          original_filename: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["file_uploads"]["Row"]> & {
          owner_id: string;
          bucket: string;
          storage_path: string;
          mime_type: string;
          file_size_bytes: number;
          checksum_sha256: string;
          original_filename: string;
        };
        Update: Partial<Database["public"]["Tables"]["file_uploads"]["Row"]>;
      };
    };
    Functions: {
      fn_write_audit_log: {
        Args: {
          p_actor_id: string | null;
          p_actor_type: string;
          p_action: string;
          p_category: string;
          p_target_table: string;
          p_target_id: string;
          p_metadata?: Record<string, unknown>;
        };
        Returns: string;
      };
      is_challenge_participant: {
        Args: { p_challenge_id: string };
        Returns: boolean;
      };
      is_dispute_participant: {
        Args: { p_dispute_id: string };
        Returns: boolean;
      };
      can_submit_proof: {
        Args: { p_dispute_id: string };
        Returns: boolean;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
  };
}
