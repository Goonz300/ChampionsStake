// supabase/functions/_ai/moderation-heuristics.test.ts

import { assertEquals } from "@std/assert";
import {
  computeConfidence,
  computeSuggestedPriority,
  suggestAction,
} from "./moderation-heuristics.ts";

const HIGH_STAKE = 10000;

Deno.test("computeSuggestedPriority: low risk, low stake -> low", () => {
  const priority = computeSuggestedPriority({
    maxPartyRiskScore: 10,
    openFraudFlagCount: 0,
    stakeCents: 500,
    highStakeThresholdCents: HIGH_STAKE,
  });
  assertEquals(priority, "low");
});

Deno.test("computeSuggestedPriority: open fraud flag + high risk -> urgent, overriding stake", () => {
  const priority = computeSuggestedPriority({
    maxPartyRiskScore: 75,
    openFraudFlagCount: 1,
    stakeCents: 100,
    highStakeThresholdCents: HIGH_STAKE,
  });
  assertEquals(priority, "urgent");
});

Deno.test("computeSuggestedPriority: high risk alone (no fraud flag) -> high, not urgent", () => {
  const priority = computeSuggestedPriority({
    maxPartyRiskScore: 75,
    openFraudFlagCount: 0,
    stakeCents: 100,
    highStakeThresholdCents: HIGH_STAKE,
  });
  assertEquals(priority, "high");
});

Deno.test("computeSuggestedPriority: a very high stake alone can push to high even with low risk", () => {
  const priority = computeSuggestedPriority({
    maxPartyRiskScore: 5,
    openFraudFlagCount: 0,
    stakeCents: HIGH_STAKE * 5,
    highStakeThresholdCents: HIGH_STAKE,
  });
  assertEquals(priority, "high");
});

Deno.test("suggestAction: open fraud flags take precedence over everything else", () => {
  const action = suggestAction({
    openFraudFlagCount: 2,
    maxPartyRiskScore: 90,
    isRepeatDisputePair: true,
    evidenceCount: 5,
  });
  assertEquals(action.includes("fraud flags"), true);
});

Deno.test("suggestAction: no evidence yet suggests waiting", () => {
  const action = suggestAction({
    openFraudFlagCount: 0,
    maxPartyRiskScore: 10,
    isRepeatDisputePair: false,
    evidenceCount: 0,
  });
  assertEquals(action.includes("No evidence"), true);
});

Deno.test("suggestAction: clean case with evidence gets the standard-review message", () => {
  const action = suggestAction({
    openFraudFlagCount: 0,
    maxPartyRiskScore: 10,
    isRepeatDisputePair: false,
    evidenceCount: 1,
  });
  assertEquals(action.includes("Standard review"), true);
});

Deno.test("computeConfidence: full data on every signal reaches maximum confidence", () => {
  const confidence = computeConfidence({
    hasRiskScoreForBothParties: true,
    hasFraudFlagData: true,
    evidenceCount: 3,
  });
  assertEquals(confidence, 1);
});

Deno.test("computeConfidence: missing risk score data lowers confidence but never to zero", () => {
  const confidence = computeConfidence({
    hasRiskScoreForBothParties: false,
    hasFraudFlagData: false,
    evidenceCount: 0,
  });
  assertEquals(confidence, 0.4);
  assertEquals(confidence > 0, true);
});
