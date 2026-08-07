/**
 * Supabase Database types.
 *
 * IMPORTANT: this file is hand-written. It is NOT a substitute for real
 * generated types.
 *
 * Once a live Supabase project exists, replace this entire file with:
 *   supabase gen types typescript --project-id <ref> > lib/supabase/types.ts
 * (or --local, against a locally running instance). Every table below was
 * added by hand, transcribed from its defining migration, because no live
 * instance has ever existed in this environment to regenerate against —
 * this is a tracked stopgap, not the intended long-term process. Tables
 * outside the ones declared here (challenges, wallet_ledger, disputes,
 * etc.) still need real generated types before code that queries them is
 * added; keep hand-extending only when a new page/route genuinely needs a
 * new table, and keep each addition in sync with its migration by hand.
 */

export type UserRole = "player" | "moderator" | "administrator" | "support" | "organizer";
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
          user_agent: string | null;
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
          device_id: string | null;
          created_at: string;
          expires_at: string;
          revoked_at: string | null;
          updated_at: string;
          mfa_verified_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["user_sessions"]["Row"]> & {
          user_id: string;
          refresh_token_hash: string;
          expires_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_sessions"]["Row"]>;
      };
      mfa_recovery_codes: {
        Row: {
          id: string;
          user_id: string;
          code_hash: string;
          used_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["mfa_recovery_codes"]["Row"]> & {
          user_id: string;
          code_hash: string;
        };
        Update: Partial<Database["public"]["Tables"]["mfa_recovery_codes"]["Row"]>;
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          category: string;
          payload: Record<string, unknown>;
          status: "unread" | "read";
          created_at: string;
          read_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["notifications"]["Row"]> & {
          user_id: string;
          type: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
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
      // --- Phase 8 tournament platform tables --------------------------
      // Stopgap hand-extension, not a violation of the header note above:
      // this file's own instruction is to regenerate against a live
      // Supabase project, but no live project exists in this environment,
      // so there is nothing to regenerate against. Shapes below are
      // transcribed directly from their defining migrations (0006, 0007,
      // 0094, 0095, 0100) and kept in sync with them by hand until a real
      // `supabase gen types typescript` run replaces this whole file.
      games: {
        Row: {
          id: string;
          name: string;
          slug: string;
          icon_url: string | null;
          supported_platform_codes: string[];
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["games"]["Row"]> & {
          name: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["games"]["Row"]>;
      };
      tournaments: {
        Row: {
          id: string;
          game_id: string;
          name: string;
          format: "single_elim" | "double_elim" | "round_robin" | "swiss";
          entry_fee_cents: number;
          prize_pool_cents: number;
          payout_structure: Record<string, unknown>;
          status: string;
          visibility: "public" | "private" | "invite_only";
          is_recurring: boolean;
          recurrence_rule: string | null;
          template_id: string | null;
          sponsor_name: string | null;
          sponsor_logo_url: string | null;
          registration_opens_at: string | null;
          registration_closes_at: string | null;
          check_in_opens_at: string | null;
          starts_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["tournaments"]["Row"]> & {
          game_id: string;
          name: string;
          format: "single_elim" | "double_elim" | "round_robin" | "swiss";
          entry_fee_cents: number;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["tournaments"]["Row"]>;
      };
      tournament_registrations: {
        Row: {
          id: string;
          tournament_id: string;
          user_id: string;
          seed: number | null;
          checked_in_at: string | null;
          eliminated: boolean;
          forfeited: boolean;
          entry_escrow_transaction_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tournament_registrations"]["Row"]> & {
          tournament_id: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["tournament_registrations"]["Row"]>;
      };
      teams: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          team_type: "team" | "organization" | "clan";
          parent_organization_id: string | null;
          owner_id: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["teams"]["Row"]> & {
          name: string;
          slug: string;
          owner_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["teams"]["Row"]>;
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          user_id: string;
          role: "owner" | "captain" | "member";
          joined_at: string;
          left_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["team_members"]["Row"]> & {
          team_id: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_members"]["Row"]>;
      };
      leagues: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          game_id: string;
          region_code: string | null;
          status: "active" | "archived";
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["leagues"]["Row"]> & {
          name: string;
          slug: string;
          game_id: string;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["leagues"]["Row"]>;
      };
      divisions: {
        Row: {
          id: string;
          league_id: string;
          name: string;
          tier: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["divisions"]["Row"]> & {
          league_id: string;
          name: string;
          tier: number;
        };
        Update: Partial<Database["public"]["Tables"]["divisions"]["Row"]>;
      };
      seasons: {
        Row: {
          id: string;
          league_id: string;
          name: string;
          status: "upcoming" | "active" | "completed" | "archived";
          starts_at: string | null;
          ends_at: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["seasons"]["Row"]> & {
          league_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["seasons"]["Row"]>;
      };
      season_participants: {
        Row: {
          id: string;
          season_id: string;
          division_id: string;
          user_id: string | null;
          team_id: string | null;
          wins: number;
          losses: number;
          draws: number;
          points: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["season_participants"]["Row"]> & {
          season_id: string;
          division_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["season_participants"]["Row"]>;
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
      is_moderator: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
  };
}
