import type { DomainListing, DomainMarketplaceProvider, ListingType } from "@/lib/domain-marketplace/types";

interface SedoProviderOptions {
  partnerId: string;
  signKey: string;
  endpoint?: string;
  timeoutMs?: number;
  tld?: string;
  kwtype?: "B" | "C" | "E";
  resultSize?: number;
  language?: string;
}

type SedoCurrencyCode = "0" | "1" | "2";

const SEDO_CURRENCY_MAP: Record<SedoCurrencyCode, string> = {
  "0": "EUR",
  "1": "USD",
  "2": "GBP",
};

export class SedoProvider implements DomainMarketplaceProvider {
  readonly providerName = "sedo";

  private readonly partnerId: string;
  private readonly signKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly tld: string;
  private readonly kwtype: "B" | "C" | "E";
  private readonly resultSize: number;
  private readonly language: string;

  constructor(options: SedoProviderOptions) {
    this.partnerId = options.partnerId.trim();
    this.signKey = options.signKey.trim();
    this.endpoint = options.endpoint ?? "https://api.sedo.com/api/v1/DomainSearch";
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.tld = options.tld ?? "com";
    this.kwtype = options.kwtype ?? "C";
    this.resultSize = options.resultSize ?? 50;
    this.language = options.language ?? "en";
  }

  async searchDomains(keyword: string): Promise<DomainListing[]> {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return [];

    const keywordBase = normalized.includes(".")
      ? (normalized.split(".")[0] ?? normalized)
      : normalized;

    const url = new URL(this.endpoint);
    url.searchParams.set("partnerid", this.partnerId);
    url.searchParams.set("signkey", this.signKey);
    url.searchParams.set("output_method", "xml");
    url.searchParams.set("keyword", keywordBase);
    url.searchParams.set("tld", this.tld);
    url.searchParams.set("kwtype", this.kwtype);
    url.searchParams.set("no_hyphen", "0");
    url.searchParams.set("no_numeral", "0");
    url.searchParams.set("no_idn", "0");
    url.searchParams.set("resultsize", String(this.resultSize));
    url.searchParams.set("language", this.language);

    const response = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Accept: "application/xml,text/xml,*/*" },
      cache: "no-store",
    });

    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`Sedo request failed (${response.status}): ${xml.slice(0, 200)}`);
    }

    if (xml.includes("<SEDOFAULT")) {
      const faultCode = this.extractTag(xml, "faultcode") ?? "UNKNOWN";
      const faultString = this.extractTag(xml, "faultstring") ?? "Unknown Sedo fault";
      throw new Error(`Sedo fault ${faultCode}: ${faultString}`);
    }

    return this.parseSearchXml(xml);
  }

  private parseSearchXml(xml: string): DomainListing[] {
    const items: DomainListing[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    const matches = xml.matchAll(itemRegex);

    for (const match of matches) {
      const itemXml = match[1] ?? "";
      const domain = this.extractTag(itemXml, "domain")?.toLowerCase();
      const priceRaw = this.extractTag(itemXml, "price");
      const currencyRaw = this.extractTag(itemXml, "currency") as SedoCurrencyCode | undefined;
      const typeRaw = this.extractTag(itemXml, "type");

      if (!domain) continue;

      const priceParsed = priceRaw != null ? Number.parseFloat(priceRaw) : Number.NaN;
      const price = Number.isFinite(priceParsed) ? priceParsed : null;
      const currency = currencyRaw ? SEDO_CURRENCY_MAP[currencyRaw] ?? null : null;

      items.push({
        domain,
        price,
        currency,
        marketplace: "Sedo",
        listingType: this.mapListingType(typeRaw),
      });
    }

    return items;
  }

  private extractTag(xml: string, tagName: string): string | null {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
    const match = xml.match(regex);
    return match?.[1]?.trim() ?? null;
  }

  private mapListingType(typeRaw: string | null): ListingType {
    // Sedo docs: D = domain; W = website. Not enough detail for auction/BIN split.
    if ((typeRaw ?? "").toUpperCase() === "D") {
      return "makeOffer";
    }
    return "buyNow";
  }
}
