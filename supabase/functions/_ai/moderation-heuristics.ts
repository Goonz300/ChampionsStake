// supabase/functions/_ai/moderation-heuristics.ts
//
// Phase 7 (AI-006): pure logic for the AI Moderation Assistant, extracted
// for unit testing, same convention as every other _ai/*-heuristics.ts
// module. Assistive only -- these functions produce a SUGGESTION; nothing
// here ever decides a dispute's outcome or writes disputes.priority.

export type DisputePriority = "low" | "normal" | "high" | "urgent";

export interface PrioritySignals {
  maxPartyRiskScore: number; // higher of the two parties' player risk_scores.score
  openFraudFlagCount: number; // combined open fraud_flags touching either party
  stakeCents: number;
  highStakeThresholdCents: number;
}

/**
 * Suggested priority: a plain threshold ladder over existing Risk Engine
 * (Phase 7 M2) and fraud_flags signals -- reproducible and explainable,
 * same bar as every other _ai scoring function, not a black-box model.
 */
export function computeSuggestedPriority(
  signals: PrioritySignals,
): DisputePriority {
  if (signals.openFraudFlagCount > 0 && signals.maxPartyRiskScore >= 70) {
    return "urgent";
  }
  if (
    signals.maxPartyRiskScore >= 70 ||
    signals.stakeCents >= signals.highStakeThresholdCents * 5
  ) {
    return "high";
  }
  if (
    signals.maxPartyRiskScore >= 40 ||
    signals.stakeCents >= signals.highStakeThresholdCents
  ) {
    return "normal";
  }
  return "low";
}

export interface ActionSignals {
  openFraudFlagCount: number;
  maxPartyRiskScore: number;
  isRepeatDisputePair: boolean; // same two users have disputed before
  evidenceCount: number;
}

/**
 * Suggested action: a short, human-readable next step -- never an
 * instruction the system carries out itself, only text a moderator reads.
 */
export function suggestAction(signals: ActionSignals): string {
  if (signals.openFraudFlagCount > 0) {
    return "Review open fraud flags on the parties before deciding -- this case may be linked to a broader pattern.";
  }
  if (signals.isRepeatDisputePair) {
    return "These two players have disputed before -- check prior dispute history for a pattern (possible collusion or genuine ongoing conflict).";
  }
  if (signals.evidenceCount === 0) {
    return "No evidence submitted yet -- consider waiting for the evidence deadline before deciding.";
  }
  if (signals.maxPartyRiskScore >= 70) {
    return "A party has an elevated risk score -- weigh evidence carefully rather than defaulting to their account of events.";
  }
  return "Standard review -- no elevated risk signals detected.";
}

export interface ConfidenceSignals {
  hasRiskScoreForBothParties: boolean;
  hasFraudFlagData: boolean;
  evidenceCount: number;
}

/**
 * Confidence reflects data completeness, not correctness -- a suggestion
 * made with partial data (e.g. one party has no computed risk score yet)
 * is flagged as lower-confidence rather than silently treated the same as
 * a fully-informed one.
 */
export function computeConfidence(signals: ConfidenceSignals): number {
  let confidence = 0.4;
  if (signals.hasRiskScoreForBothParties) confidence += 0.3;
  if (signals.hasFraudFlagData) confidence += 0.15;
  if (signals.evidenceCount > 0) confidence += 0.15;
  return Math.min(1, confidence);
}
