export type ListingType = "buyNow" | "auction" | "makeOffer";

export interface DomainListing {
  domain: string;
  price: number | null;
  currency: string | null;
  marketplace: string;
  listingType: ListingType;
}

export interface DomainMarketplaceProvider {
  readonly providerName: string;
  searchDomains(keyword: string): Promise<DomainListing[]>;
}
