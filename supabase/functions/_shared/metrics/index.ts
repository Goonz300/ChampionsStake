// supabase/functions/_shared/metrics/index.ts
//
// Lightweight metrics via structured log lines (level="metric"), designed
// to be scraped by whatever external log-based metrics pipeline is set up
// (e.g. a Supabase log drain into Datadog/Grafana). This framework does not
// stand up its own metrics database table — that would duplicate what
// Supabase's own Edge Function logs and Postgres's own query stats already
// provide, and metrics storage/dashboards are an operational choice outside
// this phase's "no business logic, shared infrastructure only" scope.

import { logger } from "../logger/index.ts";

export function recordLatency(
  functionName: string,
  durationMs: number,
  outcome: "success" | "error",
): void {
  logger.info("metric.latency", {
    metric: "latency_ms",
    functionName,
    durationMs,
    outcome,
  });
}

export function recordErrorMetric(
  functionName: string,
  errorCode: string,
): void {
  logger.info("metric.error", {
    metric: "error_count",
    functionName,
    errorCode,
  });
}

export function recordCounter(
  name: string,
  value = 1,
  tags: Record<string, unknown> = {},
): void {
  logger.info("metric.counter", { metric: name, value, ...tags });
}

/**
 * Wraps a handler to automatically record latency + success/error outcome.
 * Used internally by middleware/compose.ts — most functions won't call this
 * directly.
 */
export async function withTiming<T>(
  functionName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    recordLatency(functionName, performance.now() - start, "success");
    return result;
  } catch (err) {
    recordLatency(functionName, performance.now() - start, "error");
    throw err;
  }
}
