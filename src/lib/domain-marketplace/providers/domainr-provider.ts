import type { DomainListing, DomainMarketplaceProvider, ListingType } from "@/lib/domain-marketplace/types";

interface DomainrProviderOptions {
  clientId?: string;
  rapidApiKey?: string;
  timeoutMs?: number;
  maxResults?: number;
}

interface DomainrSearchResponse {
  results?: Array<{ domain?: string }>;
}

interface DomainrStatusResponse {
  status?: Array<{
    domain?: string;
    status?: string;
    summary?: string;
  }>;
}

export class DomainrProvider implements DomainMarketplaceProvider {
  readonly providerName = "domainr";

  private readonly clientId?: string;
  private readonly rapidApiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxResults: number;

  constructor(options: DomainrProviderOptions = {}) {
    this.clientId = options.clientId?.trim();
    this.rapidApiKey = options.rapidApiKey?.trim();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResults = options.maxResults ?? 15;
  }

  async searchDomains(keyword: string): Promise<DomainListing[]> {
    const query = keyword.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const searchPayload = await this.fetchDomainr<DomainrSearchResponse>("/v2/search", {
      query,
    });
    const candidates = (searchPayload.results ?? [])
      .map((item) => item.domain?.toLowerCase())
      .filter((value): value is string => Boolean(value))
      .slice(0, this.maxResults);

    if (candidates.length === 0) {
      return [];
    }

    const statusPayload = await this.fetchDomainr<DomainrStatusResponse>("/v2/status", {
      domain: candidates.join(","),
    });

    return (statusPayload.status ?? [])
      .filter((entry) => {
        const statusText = `${entry.status ?? ""} ${entry.summary ?? ""}`.toLowerCase();
        // Domainr does not return prices; keep entries that look aftermarket-related.
        return statusText.includes("for_sale") || statusText.includes("marketed");
      })
      .map((entry) => ({
        domain: entry.domain ?? "",
        price: null,
        currency: null,
        marketplace: "Domainr",
        listingType: this.inferListingType(entry.status),
      }))
      .filter((entry) => entry.domain.length > 0);
  }

  private inferListingType(status: string | undefined): ListingType {
    const value = (status ?? "").toLowerCase();
    if (value.includes("auction")) {
      return "auction";
    }
    if (value.includes("buy_now") || value.includes("fixed")) {
      return "buyNow";
    }
    return "makeOffer";
  }

  private async fetchDomainr<T>(path: string, query: Record<string, string>): Promise<T> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const isRapid = Boolean(this.rapidApiKey);
    const base = isRapid ? "https://domainr.p.rapidapi.com" : "https://api.domainr.com";
    const url = new URL(path, base);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    if (isRapid) {
      url.searchParams.set("mashape-key", this.rapidApiKey!);
    } else if (this.clientId) {
      url.searchParams.set("client_id", this.clientId);
    } else {
      throw new Error("DomainrProvider requires DOMAINR_CLIENT_ID or DOMAINR_RAPIDAPI_KEY");
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Domainr request failed (${response.status})`);
    }

    return (await response.json()) as T;
  }
}
