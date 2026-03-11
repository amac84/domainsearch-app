const DEFAULT_MAX_DOMAINS_TO_CHECK = 450;

export interface DomainBuildOptions {
  tlds: string[];
  includePrefixVariants?: boolean;
  maxDomainsToCheck?: number;
}

export interface DomainPair {
  base: string;
  domain: string;
}

function sanitizeTld(tld: string): string {
  return tld.trim().toLowerCase().replace(/^\.+/, "");
}

export function normalizeBaseName(name: string, maxLength: number): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, maxLength);
}

export function normalizeBaseNames(
  names: string[],
  maxLength: number,
): string[] {
  const deduped = new Set<string>();

  for (const value of names) {
    const normalized = normalizeBaseName(value, maxLength);
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }

  return Array.from(deduped);
}

export function buildDomainsForNames(
  baseNames: string[],
  options: DomainBuildOptions,
): DomainPair[] {
  const tlds = Array.from(
    new Set(options.tlds.map(sanitizeTld).filter(Boolean)),
  );
  const maxDomains = options.maxDomainsToCheck ?? DEFAULT_MAX_DOMAINS_TO_CHECK;
  const pairs: DomainPair[] = [];

  for (const base of baseNames) {
    for (const tld of tlds) {
      pairs.push({ base, domain: `${base}.${tld}` });
      if (pairs.length >= maxDomains) {
        return pairs;
      }
    }

    if (!options.includePrefixVariants) {
      continue;
    }

    for (const prefix of ["get", "try"]) {
      for (const tld of tlds) {
        pairs.push({ base, domain: `${prefix}${base}.${tld}` });
        if (pairs.length >= maxDomains) {
          return pairs;
        }
      }
    }
  }

  return pairs;
}
