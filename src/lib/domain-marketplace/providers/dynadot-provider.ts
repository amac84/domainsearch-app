import type { DomainListing, DomainMarketplaceProvider, ListingType } from "@/lib/domain-marketplace/types";

interface DynadotProviderOptions {
  apiKey: string;
  useSandbox?: boolean;
  currency?: string;
  timeoutMs?: number;
}

interface DynadotListingItemResponse {
  [key: string]: unknown;
  GetListingsItemResponse?: {
    ResponseCode?: number;
    Status?: string;
    Error?: string;
    Listing?: {
      Domain?: string;
      Price?: string;
      Type?: string;
    };
  };
}

interface DynadotOpenAuctionsResponse {
  [key: string]: unknown;
  GetOpenAuctionsResponse?: {
    ResponseCode?: number;
    Status?: string;
    Error?: string;
    AuctionItem?: Array<{
      domain?: string;
      current_bid_price?: string;
      currency?: string;
    }>;
  };
}

export class DynadotProvider implements DomainMarketplaceProvider {
  readonly providerName = "dynadot";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly currency: string;
  private readonly timeoutMs: number;

  constructor(options: DynadotProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.useSandbox
      ? "https://api-sandbox.dynadot.com/api3.json"
      : "https://api.dynadot.com/api3.json";
    this.currency = (options.currency ?? "usd").toLowerCase();
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async searchDomains(keyword: string): Promise<DomainListing[]> {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const domain = normalized.includes(".") ? normalized : `${normalized}.com`;
    const listings: DomainListing[] = [];

    // Direct listing lookup for exact domain.
    const listingItem = await this.callApi<DynadotListingItemResponse>({
      command: "get_listing_item",
      domain,
      currency: this.currency,
    });

    const listingPayload = listingItem.GetListingsItemResponse;
    if ((listingPayload?.Status ?? "").toLowerCase() === "success" && listingPayload?.Listing?.Domain) {
      const listingDomain = listingPayload.Listing.Domain.toLowerCase();
      const price = this.parsePrice(listingPayload.Listing.Price);
      const listingType = this.mapListingType(listingPayload.Listing.Type);
      listings.push({
        domain: listingDomain,
        price,
        currency: this.currency.toUpperCase(),
        marketplace: "Dynadot",
        listingType,
      });
    }

    // Optional broader scan for auctions matching keyword.
    const openAuctions = await this.callApi<DynadotOpenAuctionsResponse>({
      command: "get_open_auctions",
      currency: this.currency,
      type: "expired",
      count_per_page: "50",
      page_index: "1",
    });

    const auctionItems = openAuctions.GetOpenAuctionsResponse?.AuctionItem ?? [];
    for (const item of auctionItems) {
      const auctionDomain = (item.domain ?? "").toLowerCase();
      if (!auctionDomain.includes(normalized.replace(".com", ""))) {
        continue;
      }
      listings.push({
        domain: auctionDomain,
        price: this.parsePrice(item.current_bid_price),
        currency: (item.currency ?? this.currency).toUpperCase(),
        marketplace: "Dynadot",
        listingType: "auction",
      });
    }

    return this.dedupe(listings);
  }

  private async callApi<T extends object>(
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("key", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Dynadot request failed (${response.status})`);
    }

    const json = (await response.json()) as T;
    const maybeGeneric = json as {
      Response?: { ResponseCode?: string | number; Error?: string };
    };
    if (
      maybeGeneric.Response &&
      String(maybeGeneric.Response.ResponseCode ?? "") === "-1"
    ) {
      throw new Error(maybeGeneric.Response.Error ?? "Dynadot API error");
    }

    const serialized = JSON.stringify(json).toLowerCase();
    if (serialized.includes("\"status\":\"error\"")) {
      throw new Error(`Dynadot API returned error: ${JSON.stringify(json)}`);
    }

    return json;
  }

  private parsePrice(raw: string | undefined): number | null {
    if (!raw) {
      return null;
    }
    const parsed = Number.parseFloat(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private mapListingType(type: string | undefined): ListingType {
    const normalized = (type ?? "").toUpperCase();
    if (normalized.includes("AUCTION")) {
      return "auction";
    }
    if (normalized.includes("BIN")) {
      return "buyNow";
    }
    return "makeOffer";
  }

  private dedupe(items: DomainListing[]): DomainListing[] {
    const map = new Map<string, DomainListing>();
    for (const item of items) {
      const key = `${item.domain}|${item.listingType}|${item.marketplace}`;
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  }
}
