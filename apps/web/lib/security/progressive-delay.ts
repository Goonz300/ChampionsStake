import { serverEnv } from "@/lib/env";

const DEFAULT_STEPS_SECONDS = [0, 2, 5, 15, 30];

function parseSteps(): number[] {
  const raw = serverEnv.PROGRESSIVE_DELAY_STEPS_SECONDS;
  if (!raw) return DEFAULT_STEPS_SECONDS;

  const parsed = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));

  return parsed.length > 0 ? parsed : DEFAULT_STEPS_SECONDS;
}

/**
 * Layer 7 (Progressive Delays): instead of rejecting an attempt outright
 * once a limit is hit, each successive recent failure adds latency before
 * the attempt is even processed -- makes scripted brute-forcing slower
 * without locking a legitimate user out on their second typo. Applied
 * ahead of (not instead of) the existing hard rate limit
 * (isLoginRateLimited/isMfaVerifyRateLimited in lib/auth/rate-limit.ts) --
 * this is a speed bump, not the actual gate.
 */
export function getProgressiveDelayMs(recentFailureCount: number): number {
  const steps = parseSteps();
  const index = Math.min(recentFailureCount, steps.length - 1);
  const seconds = steps[index] ?? 0;
  return Math.max(0, seconds) * 1000;
}

export function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
