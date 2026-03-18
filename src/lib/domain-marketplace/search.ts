import type { DomainListing, DomainMarketplaceProvider } from "@/lib/domain-marketplace/types";

export async function searchAcrossProviders(
  keyword: string,
  providers: DomainMarketplaceProvider[],
): Promise<DomainListing[]> {
  const settled = await Promise.allSettled(
    providers.map(async (provider) => provider.searchDomains(keyword)),
  );

  const listings: DomainListing[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      listings.push(...result.value);
    }
  }

  const deduped = new Map<string, DomainListing>();
  for (const listing of listings) {
    const key = `${listing.marketplace}|${listing.domain}|${listing.listingType}`;
    if (!deduped.has(key)) {
      deduped.set(key, listing);
    }
  }

  return Array.from(deduped.values());
}
