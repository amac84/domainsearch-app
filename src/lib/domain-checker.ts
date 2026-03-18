import type { DomainResult } from "@/types";
import { logError, logWarn } from "@/lib/server-logger";

interface CachedResult {
  value: DomainResult;
  expiresAt: number;
}

interface CheckDomainsOptions {
  baseUrl: string;
  endpointPath?: string;
  ttlSeconds?: number;
  concurrency?: number;
}

const cache = new Map<string, CachedResult>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function checkDomains(
  domains: string[],
  options: CheckDomainsOptions,
): Promise<Map<string, DomainResult>> {
  const dedupedDomains = Array.from(new Set(domains));
  const ttlSeconds = Math.min(Math.max(options.ttlSeconds ?? 21600, 60), 86400);
  const concurrency = Math.min(Math.max(options.concurrency ?? 15, 1), 25);
  const endpointPath = options.endpointPath ?? "/api/lookup/{base}";
  const byDomain = new Map<string, DomainResult>();
  const missing: string[] = [];
  let fetchedCount = 0;
  let fetchedErrorCount = 0;

  for (const domain of dedupedDomains) {
    const cached = getCached(domain);
    if (cached) {
      byDomain.set(domain, cached);
    } else {
      missing.push(domain);
    }
  }

  for (const domainChunk of chunk(missing, concurrency)) {
    const results = await Promise.all(
      domainChunk.map(async (domain) => {
        try {
          const lookupUrl = buildLookupUrl(options.baseUrl, endpointPath, domain);
          const response = await fetch(lookupUrl, { cache: "no-store" });
          if (!response.ok) {
            logWarn("domain_check.non_ok_response", {
              domain,
              status: response.status,
              endpointPath,
              baseUrl: options.baseUrl,
            });
            return <DomainResult>{
              domain,
              available: false,
              status: "error",
              source: "api",
            };
          }

          const json = (await response.json()) as unknown;
          return mapApiResponseToDomainResult(domain, json);
        } catch (error) {
          logError("domain_check.request_failed", error, {
            domain,
            endpointPath,
            baseUrl: options.baseUrl,
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
      }
    }

    await sleep(60);
  }

  if (fetchedCount > 0 && fetchedErrorCount === fetchedCount) {
    logError(
      "domain_check.all_fetches_failed",
      new Error("Every domain check request failed."),
      {
        fetchedCount,
        endpointPath,
        baseUrl: options.baseUrl,
      },
    );
    // Return results instead of throwing so names still appear with error badges;
    // user can fix URL/path and retry.
  }

  return byDomain;
}
