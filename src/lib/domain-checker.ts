import type { DomainResult } from "@/types";
import {
  getCachedDomainsBatch,
  setCachedDomainsBatch,
} from "@/lib/domain-cache-store";
import { logError, logInfo, logWarn } from "@/lib/server-logger";

interface CachedResult {
  value: DomainResult;
  expiresAt: number;
}

export type DomainCheckProvider = "http" | "whoisxml";

interface CheckDomainsOptions {
  /**
   * `http` — your own or agent lookup service (`baseUrl` + `endpointPath`).
   * `whoisxml` — WhoisXML Domain Availability API (`WHOISXML_API_KEY`).
   */
  provider?: DomainCheckProvider;
  /** Required when `provider` is `http` (default). Ignored for `whoisxml`. */
  baseUrl?: string;
  endpointPath?: string;
  ttlSeconds?: number;
  concurrency?: number;
  /** Delay in ms between chunks to avoid overwhelming the lookup API. Default from env or 10. */
  chunkDelayMs?: number;
}

const cache = new Map<string, CachedResult>();

/**
 * When `npm run dev` and `DOMAIN_CHECK_DEV_STUB` is set, skip HTTP to the agent
 * service so the app runs end-to-end if that host is down (e.g. Vercel paused).
 * Ignored in production builds. Values: `available`, `taken`, or `1`/`true` (= available).
 */
function devDomainStubMode(): "available" | "taken" | null {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  const raw = process.env.DOMAIN_CHECK_DEV_STUB?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "available" || raw === "1" || raw === "true") return "available";
  if (raw === "taken") return "taken";
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 429]);

/** Retry fetch on common transient upstream errors (503, 502, 429). */
async function fetchLookupWithRetry(lookupUrl: string): Promise<{
  response: Response;
  attempts: number;
}> {
  const maxAttempts = Math.min(
    Math.max(Number(process.env.DOMAIN_CHECK_MAX_RETRIES ?? "3"), 1),
    6,
  );
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(lookupUrl, { cache: "no-store" });
    if (response.ok) {
      return { response, attempts: attempt };
    }
    if (TRANSIENT_HTTP_STATUSES.has(response.status) && attempt < maxAttempts) {
      await sleep(250 * attempt);
      continue;
    }
    return { response, attempts: attempt };
  }
  throw new Error("fetchLookupWithRetry: internal error");
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function getCached(domain: string): DomainResult | null {
  const value = cache.get(domain);
  if (!value) {
    return null;
  }

  if (Date.now() >= value.expiresAt) {
    cache.delete(domain);
    return null;
  }

  return { ...value.value, source: "cache" };
}

function setCached(domain: string, value: DomainResult, ttlSeconds: number): void {
  cache.set(domain, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function resolveProvider(options: CheckDomainsOptions): DomainCheckProvider {
  if (options.provider === "whoisxml" || options.provider === "http") {
    return options.provider;
  }
  const fromEnv = process.env.DOMAIN_CHECK_PROVIDER?.trim().toLowerCase();
  return fromEnv === "whoisxml" ? "whoisxml" : "http";
}

function buildWhoisXmlLookupUrl(domain: string, apiKey: string): string {
  const endpoint =
    process.env.WHOISXML_DOMAIN_AVAILABILITY_URL?.trim() ||
    "https://domain-availability.whoisxmlapi.com/api/v1";
  const url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("domainName", domain);
  url.searchParams.set("outputFormat", "JSON");
  url.searchParams.set("credits", "DA");
  const mode = process.env.WHOISXML_DOMAIN_CHECK_MODE?.trim();
  if (mode === "DNS_AND_WHOIS" || mode === "DNS_ONLY") {
    url.searchParams.set("mode", mode);
  }
  const rdap = process.env.WHOISXML_RDAP?.trim();
  if (rdap === "0" || rdap === "1" || rdap === "2") {
    url.searchParams.set("rdap", rdap);
  }
  return url.toString();
}

function mapWhoisXmlToDomainResult(domain: string, payload: unknown): DomainResult {
  const json = payload as {
    DomainInfo?: {
      domainName?: string;
      domainAvailability?: string;
    };
    messages?: string;
    code?: number;
  };
  const availability = json.DomainInfo?.domainAvailability?.toUpperCase();
  if (availability === "AVAILABLE") {
    return {
      domain: json.DomainInfo?.domainName ?? domain,
      available: true,
      status: "available",
      source: "api",
    };
  }
  if (availability === "UNAVAILABLE") {
    return {
      domain: json.DomainInfo?.domainName ?? domain,
      available: false,
      status: "taken",
      source: "api",
    };
  }
  if (availability === "UNDETERMINED") {
    return {
      domain: json.DomainInfo?.domainName ?? domain,
      available: false,
      status: "error",
      source: "api",
    };
  }
  return {
    domain,
    available: false,
    status: "error",
    source: "api",
  };
}

function buildLookupUrl(
  baseUrl: string,
  endpointPath: string,
  domain: string,
): string {
  // Support both:
  // 1) query style, e.g. /api/check?domain=example.com
  // 2) path style, e.g. /api/v1/lookup/{domain}
  if (endpointPath.includes("{domain}")) {
    const encodedDomain = encodeURIComponent(domain);
    const pathWithDomain = endpointPath.replace("{domain}", encodedDomain);
    return new URL(pathWithDomain, baseUrl).toString();
  }
  const base = domain.split(".")[0] ?? domain;
  if (endpointPath.includes("{base}")) {
    const encodedBase = encodeURIComponent(base);
    const pathWithBase = endpointPath.replace("{base}", encodedBase);
    return new URL(pathWithBase, baseUrl).toString();
  }
  if (endpointPath.includes("{name}")) {
    const encodedBase = encodeURIComponent(base);
    const pathWithBase = endpointPath.replace("{name}", encodedBase);
    return new URL(pathWithBase, baseUrl).toString();
  }
  const url = new URL(endpointPath, baseUrl);
  url.searchParams.set("domain", domain);
  return url.toString();
}

/** Extract numeric price (USD) from API object; supports price, priceUsd, buyNowPrice, listPrice, etc. */
function extractPrice(obj: Record<string, unknown>): number | undefined {
  const raw =
    obj.price ??
    obj.priceUsd ??
    obj.buyNowPrice ??
    obj.listPrice ??
    obj.valuation ??
    obj.askingPrice ??
    obj.purchasePrice ??
    obj.minPrice;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === "string") {
    const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function mapApiResponseToDomainResult(domain: string, payload: unknown): DomainResult {
  const json = payload as {
    domain?: string;
    available?: boolean;
    premium?: boolean;
    status?: string;
    price?: number;
    priceUsd?: number;
    buyNowPrice?: number;
    listPrice?: number;
    domains?: Array<{
      domain?: string;
      available?: boolean;
      premium?: boolean;
      status?: string;
      price?: number;
      priceUsd?: number;
      buyNowPrice?: number;
      listPrice?: number;
    }>;
  };

  if (Array.isArray(json.domains)) {
    const matched = json.domains.find((item) => item.domain === domain);
    if (matched) {
      const price = extractPrice(matched as Record<string, unknown>);
      return {
        domain,
        available: Boolean(matched.available),
        status: matched.available ? "available" : "taken",
        premium: Boolean(matched.premium),
        price,
        source: "api",
      };
    }
  }

  if (typeof json.available === "boolean") {
    const price = extractPrice(json as Record<string, unknown>);
    return {
      domain: json.domain ?? domain,
      available: json.available,
      status: json.available ? "available" : "taken",
      premium: Boolean(json.premium),
      price,
      source: "api",
    };
  }

  return {
    domain,
    available: false,
    status: "error",
    source: "api",
  };
}

/** Result of a batch domain lookup (may mix cache hits and network fetches). */
export interface CheckDomainsResult {
  byDomain: Map<string, DomainResult>;
  /**
   * True when this call performed at least one network fetch and every fetch
   * failed (non-OK HTTP or thrown). Cached-only responses are not a failure.
   */
  allFetchAttemptsFailed: boolean;
}

export async function checkDomains(
  domains: string[],
  options: CheckDomainsOptions,
): Promise<CheckDomainsResult> {
  const dedupedDomains = Array.from(new Set(domains));
  const provider = resolveProvider(options);
  const stub = devDomainStubMode();
  if (stub && dedupedDomains.length > 0) {
    logWarn("domain_check.dev_stub", {
      mode: stub,
      domainCount: dedupedDomains.length,
      provider,
      baseUrl: options.baseUrl,
    });
    const byDomain = new Map<string, DomainResult>();
    const available = stub === "available";
    for (const domain of dedupedDomains) {
      byDomain.set(domain, {
        domain,
        available,
        status: available ? "available" : "taken",
        source: "api",
      });
    }
    return { byDomain, allFetchAttemptsFailed: false };
  }

  const ttlSeconds = Math.min(Math.max(options.ttlSeconds ?? 21600, 60), 86400);
  const rawConcurrency = Math.min(
    Math.max(options.concurrency ?? Number(process.env.DOMAIN_CHECK_CONCURRENCY ?? "20"), 1),
    40,
  );
  /** WhoisXML documents a 30 req/s throttle; stay under it when using their API. */
  const concurrency =
    provider === "whoisxml" ? Math.min(rawConcurrency, 25) : rawConcurrency;
  const chunkDelayMs = Math.max(
    0,
    options.chunkDelayMs ?? Number(process.env.DOMAIN_CHECK_CHUNK_DELAY_MS ?? "10"),
  );
  const endpointPath = options.endpointPath ?? "/api/lookup/{base}";
  const baseUrl =
    options.baseUrl?.trim() ||
    process.env.AGENT_DOMAIN_SERVICE_URL?.trim() ||
    "https://agentdomainservice.com";

  let whoisXmlApiKey = "";
  if (provider === "whoisxml") {
    whoisXmlApiKey = process.env.WHOISXML_API_KEY?.trim() ?? "";
    if (!whoisXmlApiKey) {
      logError(
        "domain_check.whoisxml_missing_api_key",
        new Error("WHOISXML_API_KEY is required when DOMAIN_CHECK_PROVIDER=whoisxml."),
        { domainCount: dedupedDomains.length },
      );
      const byDomain = new Map<string, DomainResult>();
      let anyUncached = false;
      for (const domain of dedupedDomains) {
        const cached = getCached(domain);
        if (cached) {
          byDomain.set(domain, cached);
        } else {
          anyUncached = true;
          const errResult: DomainResult = {
            domain,
            available: false,
            status: "error",
            source: "api",
          };
          byDomain.set(domain, errResult);
          setCached(domain, errResult, ttlSeconds);
        }
      }
      return {
        byDomain,
        allFetchAttemptsFailed: anyUncached,
      };
    }
  }

  const byDomain = new Map<string, DomainResult>();
  const missing: string[] = [];
  let fetchedCount = 0;
  let fetchedErrorCount = 0;
  let l2HitCount = 0;

  for (const domain of dedupedDomains) {
    const cached = getCached(domain);
    if (cached) {
      byDomain.set(domain, cached);
    } else {
      missing.push(domain);
    }
  }

  // L2 (shared Postgres cache via Supabase). Fills any L1 misses without
  // hitting the upstream API. Best-effort: if Supabase is down/unconfigured
  // this resolves to an empty Map and we just fall through to the network.
  if (missing.length > 0) {
    const l2Hits = await getCachedDomainsBatch(missing);
    if (l2Hits.size > 0) {
      const stillMissing: string[] = [];
      for (const domain of missing) {
        const hit = l2Hits.get(domain);
        if (hit) {
          byDomain.set(domain, hit);
          // Promote into L1 so the same warm instance doesn't re-query L2 for
          // it during this process's lifetime.
          setCached(domain, hit, ttlSeconds);
          l2HitCount += 1;
        } else {
          stillMissing.push(domain);
        }
      }
      missing.length = 0;
      missing.push(...stillMissing);
      logInfo("domain_check.l2_cache_hits", {
        l2HitCount,
        remainingMissing: missing.length,
        provider,
      });
    }
  }

  const fetchedFreshResults: DomainResult[] = [];

  for (const domainChunk of chunk(missing, concurrency)) {
    const results = await Promise.all(
      domainChunk.map(async (domain) => {
        try {
          const lookupUrl =
            provider === "whoisxml"
              ? buildWhoisXmlLookupUrl(domain, whoisXmlApiKey)
              : buildLookupUrl(baseUrl, endpointPath, domain);
          const { response } = await fetchLookupWithRetry(lookupUrl);
          if (!response.ok) {
            logWarn("domain_check.non_ok_response", {
              domain,
              status: response.status,
              provider,
              endpointPath: provider === "http" ? endpointPath : undefined,
              baseUrl: provider === "http" ? baseUrl : undefined,
            });
            return <DomainResult>{
              domain,
              available: false,
              status: "error",
              source: "api",
            };
          }

          const json = (await response.json()) as unknown;
          if (provider === "whoisxml") {
            return mapWhoisXmlToDomainResult(domain, json);
          }
          return mapApiResponseToDomainResult(domain, json);
        } catch (error) {
          logError("domain_check.request_failed", error, {
            domain,
            provider,
            endpointPath: provider === "http" ? endpointPath : undefined,
            baseUrl: provider === "http" ? baseUrl : undefined,
          });
          return <DomainResult>{
            domain,
            available: false,
            status: "error",
            source: "api",
          };
        }
      }),
    );

    for (const result of results) {
      byDomain.set(result.domain, result);
      setCached(result.domain, result, ttlSeconds);
      fetchedCount += 1;
      if (result.status === "error") {
        fetchedErrorCount += 1;
      } else {
        fetchedFreshResults.push(result);
      }
    }

    if (chunkDelayMs > 0) {
      await sleep(chunkDelayMs);
    }
  }

  // Write-through to the shared L2 cache. We await rather than fire-and-forget
  // because on Vercel the function instance can be suspended immediately after
  // the response is sent, dropping any in-flight upsert. The latency cost of
  // a single batch upsert is small (~tens of ms) and errors are swallowed
  // inside `setCachedDomainsBatch` so they cannot break the request.
  if (fetchedFreshResults.length > 0) {
    await setCachedDomainsBatch(fetchedFreshResults, ttlSeconds);
  }

  const allFetchAttemptsFailed =
    missing.length > 0 && fetchedCount > 0 && fetchedErrorCount === fetchedCount;

  if (allFetchAttemptsFailed) {
    logError(
      "domain_check.all_fetches_failed",
      new Error("Every domain check request failed."),
      {
        fetchedCount,
        provider,
        endpointPath: provider === "http" ? endpointPath : undefined,
        baseUrl: provider === "http" ? baseUrl : undefined,
      },
    );
  }

  return { byDomain, allFetchAttemptsFailed };
}
