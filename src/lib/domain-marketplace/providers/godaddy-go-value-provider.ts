import type { DomainListing, DomainMarketplaceProvider } from "@/lib/domain-marketplace/types";

interface GoDaddyGoValueProviderOptions {
  apiKey: string;
  apiSecret: string;
  useOte?: boolean;
  timeoutMs?: number;
}

interface GoValueResponse {
  status?: string;
  domainName?: string;
  goValue?: number;
  listPrice?: number;
  minPrice?: number;
  maxPrice?: number;
}

export class GoDaddyGoValueProvider implements DomainMarketplaceProvider {
  readonly providerName = "godaddy-govalue";

  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly timeoutMs: number;
  private readonly baseUrls: string[];

  constructor(options: GoDaddyGoValueProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.apiSecret = options.apiSecret.trim();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.baseUrls = options.useOte ? ["https://api.ote-godaddy.com"] : ["https://api.godaddy.com"];
  }

  async searchDomains(keyword: string): Promise<DomainListing[]> {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const domainName = normalized.includes(".") ? normalized : `${normalized}.com`;
    let lastError = "Unknown GoDaddy GoValue error";

    for (const baseUrl of this.baseUrls) {
      try {
        const signal = AbortSignal.timeout(this.timeoutMs);
        const url = new URL("/v1/domains/govalues", baseUrl);
        url.searchParams.set("domainName", domainName);

        const response = await fetch(url.toString(), {
          method: "GET",
          signal,
          headers: {
            Authorization: `sso-key ${this.apiKey}:${this.apiSecret}`,
            Accept: "application/json",
          },
          cache: "no-store",
        });

        if (!response.ok) {
          const body = await response.text();
          lastError = `${baseUrl} -> HTTP ${response.status} ${body.slice(0, 200)}`;
          continue;
        }

        const payload = (await response.json()) as GoValueResponse;
        const rawPrice = payload.listPrice ?? payload.goValue ?? payload.minPrice ?? payload.maxPrice;
        const price = typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : null;

        return [
          {
            domain: payload.domainName ?? domainName,
            price,
            // GoValue values are reported in USD in official examples.
            currency: "USD",
            marketplace: "GoDaddy GoValue",
            // This is valuation intelligence, not a guaranteed live listing.
            listingType: "makeOffer",
          },
        ];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = `${baseUrl} -> ${message}`;
      }
    }

    throw new Error(lastError);
  }
}
