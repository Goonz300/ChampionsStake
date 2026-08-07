// supabase/functions/_ai/matchmaking-heuristics.ts
//
// Phase 7 (AI-005): pure scoring math for Matchmaking Intelligence,
// extracted for unit testing, same convention as elo.ts/fraud-heuristics.ts/
// reputation-heuristics.ts. Combines the signals the brief names -- trust,
// timezone, region, availability (presence), device integrity, historical
// behaviour -- into one explainable 0-100 composite. "Skill" and "latency"
// are deliberately NOT separate inputs here: no skill rating exists yet
// (Phase 8 M4 builds real ELO/Glicko; trustProximity is reused as the best
// available proxy today, and will be superseded once ratings exist without
// this module needing to change its public shape), and no latency/ping
// measurement exists anywhere in this codebase -- region match is used as
// a latency PROXY (same country plausibly means lower RTT), not a real
// measurement, and is documented as such rather than fabricating a number.

export interface MatchmakingFactors {
  trustGap: number; // |candidate.trustScore - self.trustScore|
  sameTimezone: boolean;
  sameRegion: boolean;
  candidateRecentlyActive: boolean;
  candidateDeviceFlagged: boolean; // TOR/datacenter/multi-account flagged recently
  hasCollusionHistory: boolean; // an open collusion/repeated_opponent flag between this pair
}

const TRUST_PROXIMITY_MAX = 40;
const TRUST_PROXIMITY_FULL_CREDIT_GAP = 50;
const TRUST_PROXIMITY_ZERO_CREDIT_GAP = 400;
const TIMEZONE_MATCH_POINTS = 20;
const REGION_MATCH_POINTS = 15;
const AVAILABILITY_POINTS = 15;
const DEVICE_INTEGRITY_POINTS = 10;
const COLLUSION_HISTORY_PENALTY = 60;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Full credit inside a tight trust band (a fair match), linearly tapering
 * to zero credit by a wide gap (a lopsided match) -- never a hard cutoff,
 * so a slightly-outside-band opponent still ranks above a wildly-mismatched
 * one rather than being excluded outright.
 */
export function computeTrustProximityScore(trustGap: number): number {
  if (trustGap <= TRUST_PROXIMITY_FULL_CREDIT_GAP) return TRUST_PROXIMITY_MAX;
  if (trustGap >= TRUST_PROXIMITY_ZERO_CREDIT_GAP) return 0;
  const range = TRUST_PROXIMITY_ZERO_CREDIT_GAP -
    TRUST_PROXIMITY_FULL_CREDIT_GAP;
  const progress = (trustGap - TRUST_PROXIMITY_FULL_CREDIT_GAP) / range;
  return TRUST_PROXIMITY_MAX * (1 - progress);
}

export function computeMatchmakingScore(factors: MatchmakingFactors): number {
  const trustScore = computeTrustProximityScore(factors.trustGap);
  const timezoneScore = factors.sameTimezone ? TIMEZONE_MATCH_POINTS : 0;
  const regionScore = factors.sameRegion ? REGION_MATCH_POINTS : 0;
  const availabilityScore = factors.candidateRecentlyActive
    ? AVAILABILITY_POINTS
    : 0;
  const integrityScore = factors.candidateDeviceFlagged
    ? 0
    : DEVICE_INTEGRITY_POINTS;
  const collusionPenalty = factors.hasCollusionHistory
    ? COLLUSION_HISTORY_PENALTY
    : 0;

  return clampScore(
    trustScore + timezoneScore + regionScore + availabilityScore +
      integrityScore - collusionPenalty,
  );
}
