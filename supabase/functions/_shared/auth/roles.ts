// supabase/functions/_shared/auth/roles.ts

import type { UserProfile } from "./session.ts";

export function isModerator(profile: UserProfile): boolean {
  return profile.role === "moderator" || profile.role === "administrator";
}

export function isAdministrator(profile: UserProfile): boolean {
  return profile.role === "administrator";
}

export function isSupportStaff(profile: UserProfile): boolean {
  return profile.role === "support" || profile.role === "administrator";
}

/** Phase 8 (TOURNAMENT-007): 'organizer' is an admin-granted role
 * (migration 0100), same trust posture as moderator status -- not
 * self-service, since organizers create real-money tournaments.
 * Administrators implicitly retain full organizer capability. */
export function isOrganizer(profile: UserProfile): boolean {
  return profile.role === "organizer" || profile.role === "administrator";
}

export function isVerified(profile: UserProfile): boolean {
  return profile.kyc_status === "verified";
}

/**
 * "Service Role" and "Future API Client" (from this phase's Authorization
 * section) are not profile-based roles at all — service_role is a Postgres/
 * Supabase-level credential (see database/client.ts's getServiceRoleClient),
 * and Future API Client has no schema yet (per STORE-001/AUTH-001's same
 * documented deferral: it needs its own API-key/OAuth-client table, which is
 * a future Roadmap task, not something to improvise here). Both are called
 * out explicitly in permissions/index.ts rather than silently unsupported.
 */
