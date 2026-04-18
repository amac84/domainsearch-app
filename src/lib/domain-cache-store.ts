import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/server-logger";
import type { DomainResult, DomainStatus } from "@/types";

/**
 * L2 cache for domain availability results, backed by Supabase Postgres
 * (table `domain_cache`, see docs/supabase-domain-cache-migration.sql).
 *
 * The L1 cache in `domain-checker.ts` is in-memory per process, which means
 * Vercel cold starts and parallel function instances re-pay for the same
 * lookups. This shared cache lets refined searches across cold instances
 * (and other users running similar searches) skip the upstream registrar/
 * WhoisXML call entirely.
 *
 * All operations are best-effort: if Supabase is not configured or a query
 * fails, the L2 cache silently no-ops and the request falls back to the
 * normal in-memory + network path. The user-visible request never fails
 * because the shared cache is unhealthy.
 */

const L2_DISABLED_BY_ENV = process.env.DOMAIN_CACHE_L2_DISABLED === "1";
const TABLE = "domain_cache";

interface DomainCacheRow {
  domain: string;
  available: boolean;
  status: string;
  premium: boolean | null;
  price: number | string | null;
  source: string;
  expires_at: string;
}

let cachedClient: SupabaseClient | null = null;
/** Once we discover Supabase is unconfigured we stop trying. */
let discoveredUnavailable = false;

function getClient(): SupabaseClient | null {
  if (L2_DISABLED_BY_ENV || discoveredUnavailable) return null;
  if (cachedClient) return cachedClient;
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    discoveredUnavailable = true;
    return null;
  }
  try {
    cachedClient = createSupabaseAdminClient();
    return cachedClient;
  } catch (error) {
    discoveredUnavailable = true;
    logWarn("domain_cache_store.client_init_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** True iff the L2 cache is configured and reachable (used for telemetry). */
export function isL2CacheEnabled(): boolean {
  return getClient() !== null;
}

function isValidStatus(value: unknown): value is DomainStatus {
  return value === "available" || value === "taken" || value === "error";
}

function rowToResult(row: DomainCacheRow): DomainResult | null {
  if (!isValidStatus(row.status)) return null;
  const price =
    typeof row.price === "number"
      ? row.price
      : typeof row.price === "string"
        ? Number.parseFloat(row.price)
        : undefined;
  return {
    domain: row.domain,
    available: Boolean(row.available),
    status: row.status,
    premium: row.premium ?? undefined,
    price: typeof price === "number" && Number.isFinite(price) ? price : undefined,
    // Tag as cache so callers can distinguish from a fresh API hit.
    source: "cache",
  };
}

/**
 * Look up a batch of domains in the shared L2 cache, returning only those
 * present and not yet expired. Never throws.
 */
export async function getCachedDomainsBatch(
  domains: string[],
): Promise<Map<string, DomainResult>> {
  const result = new Map<string, DomainResult>();
  if (domains.length === 0) return result;
  const client = getClient();
  if (!client) return result;

  try {
    const { data, error } = await client
      .from(TABLE)
      .select("domain, available, status, premium, price, source, expires_at")
      .in("domain", domains)
      .gt("expires_at", new Date().toISOString());
    if (error) {
      logWarn("domain_cache_store.read_failed", {
        message: error.message,
        code: error.code,
        domainCount: domains.length,
      });
      return result;
    }
    for (const row of (data ?? []) as DomainCacheRow[]) {
      const mapped = rowToResult(row);
      if (mapped) {
        result.set(mapped.domain, mapped);
      }
    }
  } catch (error) {
    logError("domain_cache_store.read_threw", error, {
      domainCount: domains.length,
    });
  }
  return result;
}

/**
 * Upsert a batch of fresh lookups into the shared L2 cache. Fire-and-forget
 * from the caller's perspective; failures are logged but never thrown so
 * they cannot break a generation request.
 *
 * `error`-status results are intentionally NOT cached so a transient upstream
 * failure does not poison the shared cache for `ttlSeconds`.
 */
export async function setCachedDomainsBatch(
  results: DomainResult[],
  ttlSeconds: number,
): Promise<void> {
  if (results.length === 0) return;
  const client = getClient();
  if (!client) return;

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const rows = results
    .filter((r) => r.status !== "error")
    .map((r) => ({
      domain: r.domain,
      available: r.available,
      status: r.status,
      premium: r.premium ?? null,
      price: typeof r.price === "number" ? r.price : null,
      source: r.source,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;

  try {
    const { error } = await client
      .from(TABLE)
      .upsert(rows, { onConflict: "domain" });
    if (error) {
      logWarn("domain_cache_store.write_failed", {
        message: error.message,
        code: error.code,
        rowCount: rows.length,
      });
    }
  } catch (error) {
    logError("domain_cache_store.write_threw", error, {
      rowCount: rows.length,
    });
  }
}
