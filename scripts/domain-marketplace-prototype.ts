import { DomainrProvider } from "@/lib/domain-marketplace/providers/domainr-provider";
import { GoDaddyGoValueProvider } from "@/lib/domain-marketplace/providers/godaddy-go-value-provider";
import { SedoProvider } from "@/lib/domain-marketplace/providers/sedo-provider";
import type { DomainListing, DomainMarketplaceProvider } from "@/lib/domain-marketplace/types";

function toCad(price: number | null, currency: string | null): number | null {
  if (price == null || !currency) {
    return null;
  }
  if (currency.toUpperCase() === "CAD") {
    return price;
  }
  const usdToCad = Number.parseFloat(process.env.USD_TO_CAD ?? "1.36");
  if (currency.toUpperCase() === "USD" && Number.isFinite(usdToCad) && usdToCad > 0) {
    return price * usdToCad;
  }
  return null;
}

function buildProvidersFromEnv(): DomainMarketplaceProvider[] {
  const providers: DomainMarketplaceProvider[] = [];

  const goDaddyKey = process.env.GODADDY_API_KEY?.trim();
  const goDaddySecret = process.env.GODADDY_API_SECRET?.trim();
  if (goDaddyKey && goDaddySecret) {
    providers.push(
      new GoDaddyGoValueProvider({
        apiKey: goDaddyKey,
        apiSecret: goDaddySecret,
        useOte: process.env.GODADDY_OTE === "1" || process.env.GODADDY_OTE === "true",
      }),
    );
  }

  const domainrClientId = process.env.DOMAINR_CLIENT_ID?.trim();
  const domainrRapidApiKey = process.env.DOMAINR_RAPIDAPI_KEY?.trim();
  if (domainrClientId || domainrRapidApiKey) {
    providers.push(
      new DomainrProvider({
        clientId: domainrClientId,
        rapidApiKey: domainrRapidApiKey,
      }),
    );
  }

  const sedoPartnerId = process.env.SEDO_PARTNER_ID?.trim();
  const sedoSignKey = process.env.SEDO_SIGN_KEY?.trim();
  if (sedoPartnerId && sedoSignKey) {
    providers.push(
      new SedoProvider({
        partnerId: sedoPartnerId,
        signKey: sedoSignKey,
        endpoint: process.env.SEDO_API_ENDPOINT?.trim() || undefined,
        tld: process.env.SEDO_TLD?.trim() || "com",
        kwtype:
          (process.env.SEDO_KWTYPE?.trim().toUpperCase() as "B" | "C" | "E" | undefined) ?? "C",
        language: process.env.SEDO_LANGUAGE?.trim() || "en",
        resultSize: Number.parseInt(process.env.SEDO_RESULTSIZE ?? "50", 10),
      }),
    );
  }

  return providers;
}

async function main(): Promise<void> {
  const keyword = (process.argv[2] ?? "numbra.com").trim();
  const targetCad = Number.parseFloat(process.argv[3] ?? "22000");
  const providers = buildProvidersFromEnv();

  if (providers.length === 0) {
    throw new Error(
      "No providers configured. Add GoDaddy, Sedo, or Domainr credentials in .env before running this script.",
    );
  }

  const listings: DomainListing[] = [];
  const providerErrors: string[] = [];

  for (const provider of providers) {
    try {
      const providerListings = await provider.searchDomains(keyword);
      listings.push(...providerListings);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider.providerName}: ${message}`);
    }
  }
  console.log(`Keyword: ${keyword}`);
  console.log(`Providers used: ${providers.map((p) => p.providerName).join(", ")}`);
  console.log("");

  if (listings.length === 0) {
    console.log("No listings/valuation records returned.");
    if (providerErrors.length > 0) {
      console.log("");
      console.log("Provider errors:");
      for (const providerError of providerErrors) {
        console.log(`- ${providerError}`);
      }
    }
    return;
  }

  const rows = listings.map((item) => {
    const cad = toCad(item.price, item.currency);
    return {
      domain: item.domain,
      marketplace: item.marketplace,
      listingType: item.listingType,
      price: item.price ?? "n/a",
      currency: item.currency ?? "n/a",
      approxCad: cad != null ? cad.toFixed(2) : "n/a",
    };
  });

  console.table(rows);

  const withCad = rows
    .map((item) => ({
      ...item,
      approxCadNumber:
        typeof item.approxCad === "string" && item.approxCad !== "n/a"
          ? Number.parseFloat(item.approxCad)
          : Number.NaN,
    }))
    .filter((item) => Number.isFinite(item.approxCadNumber));

  if (withCad.length > 0 && Number.isFinite(targetCad)) {
    const closest = withCad.reduce((best, current) => {
      const bestDelta = Math.abs(best.approxCadNumber - targetCad);
      const currentDelta = Math.abs(current.approxCadNumber - targetCad);
      return currentDelta < bestDelta ? current : best;
    });

    console.log(
      `Closest to target CAD ${targetCad.toFixed(2)}: ${closest.domain} (${closest.marketplace}) -> CAD ${closest.approxCadNumber.toFixed(2)}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Prototype failed: ${message}`);
  process.exitCode = 1;
});
