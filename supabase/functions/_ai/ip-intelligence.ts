// supabase/functions/_ai/ip-intelligence.ts
//
// Phase 7 (AI-003): see migration 0087's header for why this uses free,
// no-signup public data (TOR Project's bulk exit list + AWS/GCP's published
// IP ranges) instead of a paid GeoIP/VPN-detection provider -- confirmed
// during the repository audit that none is configured anywhere in this
// codebase. Classification itself happens in Postgres (fn_classify_ip,
// migration 0087) using the native inet/cidr subnet-containment operator,
// not reimplemented CIDR math here -- more correct and lets the DB use an
// index.
//
// device_ip_history rows are written from apps/web (Next.js, lib/auth/
// device.ts) at login time, a different runtime than these Deno Edge
// Functions. Classifying synchronously at login would mean either
// duplicating this CIDR-matching logic in two languages or adding a
// network hop to every login. Instead this module backfills classification
// asynchronously on a schedule (same "sweep" pattern already established
// for trust scores and fraud flags) -- an honest, documented latency
// tradeoff, not a synchronous guarantee.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { logger } from "../_shared/logger/index.ts";

const TOR_BULK_EXIT_LIST_URL = "https://check.torproject.org/torbulkexitlist";
const AWS_IP_RANGES_URL = "https://ip-ranges.amazonaws.com/ip-ranges.json";
const GCP_IP_RANGES_URL = "https://www.gstatic.com/ipranges/cloud.json";

export async function refreshTorExitNodes(): Promise<{ count: number }> {
  const supabase = getServiceRoleClient();
  const response = await fetch(TOR_BULK_EXIT_LIST_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch TOR exit list: HTTP ${response.status}`,
    );
  }
  const text = await response.text();
  const ips = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (ips.length === 0) return { count: 0 };

  const rows = ips.map((ip) => ({
    ip_address: ip,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("tor_exit_nodes")
    .upsert(rows, { onConflict: "ip_address" });
  if (error) {
    throw new Error(`Failed to upsert TOR exit nodes: ${error.message}`);
  }
  return { count: rows.length };
}

interface AwsIpRangesResponse {
  prefixes: { ip_prefix: string }[];
}

interface GcpIpRangesResponse {
  prefixes: { ipv4Prefix?: string }[];
}

export async function refreshDatacenterRanges(): Promise<{ count: number }> {
  const supabase = getServiceRoleClient();
  const rows: { provider: string; cidr: string; updated_at: string }[] = [];
  const now = new Date().toISOString();

  const awsResponse = await fetch(AWS_IP_RANGES_URL);
  if (awsResponse.ok) {
    const data = await awsResponse.json() as AwsIpRangesResponse;
    const seen = new Set<string>();
    for (const prefix of data.prefixes ?? []) {
      if (prefix.ip_prefix && !seen.has(prefix.ip_prefix)) {
        seen.add(prefix.ip_prefix);
        rows.push({ provider: "aws", cidr: prefix.ip_prefix, updated_at: now });
      }
    }
  } else {
    logger.error("Failed to fetch AWS IP ranges", {
      status: awsResponse.status,
    });
  }

  const gcpResponse = await fetch(GCP_IP_RANGES_URL);
  if (gcpResponse.ok) {
    const data = await gcpResponse.json() as GcpIpRangesResponse;
    const seen = new Set<string>();
    for (const prefix of data.prefixes ?? []) {
      if (prefix.ipv4Prefix && !seen.has(prefix.ipv4Prefix)) {
        seen.add(prefix.ipv4Prefix);
        rows.push({
          provider: "gcp",
          cidr: prefix.ipv4Prefix,
          updated_at: now,
        });
      }
    }
  } else {
    logger.error("Failed to fetch GCP IP ranges", {
      status: gcpResponse.status,
    });
  }

  if (rows.length === 0) return { count: 0 };

  const { error } = await supabase
    .from("datacenter_ip_ranges")
    .upsert(rows, { onConflict: "provider,cidr" });
  if (error) {
    throw new Error(`Failed to upsert datacenter IP ranges: ${error.message}`);
  }
  return { count: rows.length };
}

export interface IpClassification {
  isTor: boolean;
  isDatacenter: boolean;
}

export async function classifyIp(ip: string): Promise<IpClassification> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("fn_classify_ip", { p_ip: ip });
  if (error) {
    // Fail open, same rationale as every other lookup-based control in this
    // codebase (sanctions.ts, velocity.ts): a broken classification lookup
    // must not itself block or misclassify every login platform-wide.
    logger.error("IP classification lookup failed", {
      ip,
      error: error.message,
    });
    return { isTor: false, isDatacenter: false };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    isTor: Boolean(row?.is_tor),
    isDatacenter: Boolean(row?.is_datacenter),
  };
}

/**
 * Backfills classification for recent device_ip_history rows that haven't
 * been classified yet (both flags still at their false default AND the row
 * is new enough that "never classified" is far more likely than "genuinely
 * classified as neither"). Scheduled sweep, mirrors sweepRecentChallenges'
 * shape in fraud-detection.ts.
 */
export async function backfillIpClassification(
  hours = 24,
  limit = 500,
): Promise<{ scanned: number; classified: number }> {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("device_ip_history")
    .select("id, ip_address")
    .eq("is_tor", false)
    .eq("is_datacenter", false)
    .gte("seen_at", since)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch device_ip_history rows: ${error.message}`);
  }

  let classified = 0;
  for (const row of rows ?? []) {
    const result = await classifyIp(row.ip_address as string);
    if (result.isTor || result.isDatacenter) {
      await supabase
        .from("device_ip_history")
        .update({ is_tor: result.isTor, is_datacenter: result.isDatacenter })
        .eq("id", row.id);
      classified += 1;
    }
  }

  return { scanned: (rows ?? []).length, classified };
}
