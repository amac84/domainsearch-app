import type { EnrichedBrief } from "@/types";

import topBrandsJson from "@/data/top-brands.json";
import categoryClichesJson from "@/data/category-cliches.json";

/**
 * Phase 2 of the v2 pipeline: cheap, deterministic gates that drop throwaway
 * names before any LLM-as-judge or domain-check spend. Each individual gate
 * is env-toggleable so we can loosen a filter that bites too hard without
 * deploying new code.
 */

const TOP_BRANDS: Set<string> = new Set(
  Array.isArray((topBrandsJson as { brands?: unknown }).brands)
    ? ((topBrandsJson as { brands: unknown[] }).brands.filter(
        (value) => typeof value === "string",
      ) as string[]).map((value) => value.toLowerCase())
    : [],
);

const CATEGORY_CLICHES: Record<string, string[]> = categoryClichesJson as Record<
  string,
  string[]
>;

const CONSONANT_CLUSTER_WHITELIST = [
  "str",
  "spr",
  "spl",
  "scr",
  "chr",
  "thr",
  "shr",
  "phl",
  "phr",
  "sch",
  "squ",
];

const SUFFIX_CLICHES = [
  "ify",
  "ly",
  "ery",
  "able",
  "ative",
  "ster",
];
const SHORT_SUFFIX_CLICHES = ["io", "ai", "ex", "ly"];

const PREFIX_CLICHES = [
  "smart",
  "cloud",
  "tech",
  "meta",
  "neuro",
  "quantum",
  "hyper",
  "ultra",
  "super",
  "mega",
  "nano",
  "cyber",
];

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

function flag(envName: string, defaultValue: boolean): boolean {
  const raw = process.env[envName]?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return defaultValue;
}

export interface PhoneticFilterOptions {
  industry?: string;
  brief?: EnrichedBrief;
  /** Respect the user's word-type constraint; we don't drop common suffixes
   * when the user explicitly asked for dictionary words. */
  wordTypeConstraint?: "mixed" | "invented" | "dictionary";
}

export type FilterRejectionReason =
  | "consonantPileup"
  | "suffixCliche"
  | "prefixCliche"
  | "categoryCliche"
  | "majorBrandCollision"
  | "tooShort"
  | "empty";

export interface FilterOutcome {
  kept: string[];
  dropped: Array<{ name: string; reason: FilterRejectionReason }>;
  droppedByReason: Record<FilterRejectionReason, number>;
}

function emptyReasonCounts(): Record<FilterRejectionReason, number> {
  return {
    consonantPileup: 0,
    suffixCliche: 0,
    prefixCliche: 0,
    categoryCliche: 0,
    majorBrandCollision: 0,
    tooShort: 0,
    empty: 0,
  };
}

export function hasConsonantPileup(name: string): boolean {
  const cleaned = name.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length < 4) return false;
  let run = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (VOWELS.has(ch)) {
      run = 0;
      continue;
    }
    run += 1;
    if (run >= 3) {
      const cluster = cleaned.slice(i - 2, i + 1);
      if (!CONSONANT_CLUSTER_WHITELIST.includes(cluster)) return true;
    }
  }
  return false;
}

export function endsInSuffixCliche(name: string): boolean {
  const cleaned = name.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length < 5) return false;
  for (const suffix of SUFFIX_CLICHES) {
    if (cleaned.endsWith(suffix)) return true;
  }
  for (const suffix of SHORT_SUFFIX_CLICHES) {
    if (cleaned.length >= 6 && cleaned.endsWith(suffix)) return true;
  }
  return false;
}

export function startsWithPrefixCliche(name: string): boolean {
  const cleaned = name.toLowerCase().replace(/[^a-z]/g, "");
  for (const prefix of PREFIX_CLICHES) {
    if (cleaned.startsWith(prefix) && cleaned.length > prefix.length + 1) {
      return true;
    }
  }
  return false;
}

function industryClichesFor(industry?: string): string[] {
  const key = industry?.toLowerCase().trim() ?? "";
  const list = new Set<string>();
  for (const fragment of CATEGORY_CLICHES.default ?? []) list.add(fragment);
  if (!key) return Array.from(list);
  for (const [clicheKey, fragments] of Object.entries(CATEGORY_CLICHES)) {
    if (clicheKey === "default") continue;
    if (key.includes(clicheKey)) {
      for (const fragment of fragments) list.add(fragment);
    }
  }
  return Array.from(list);
}

export function containsCategoryCliche(
  name: string,
  industry?: string,
  extraCliches: string[] = [],
): boolean {
  const cleaned = name.toLowerCase().replace(/[^a-z]/g, "");
  const fragments = [
    ...industryClichesFor(industry),
    ...extraCliches.map((value) => value.toLowerCase().trim()).filter(Boolean),
  ];
  for (const fragment of fragments) {
    const normalized = fragment.replace(/[^a-z]/g, "");
    if (!normalized || normalized.length < 3) continue;
    if (cleaned.includes(normalized)) return true;
  }
  return false;
}

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function looksLikeMajorBrand(name: string, cap = 1): boolean {
  const cleaned = name.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return false;
  if (TOP_BRANDS.has(cleaned)) return true;
  if (cleaned.length < 5) return false;
  for (const brand of TOP_BRANDS) {
    if (Math.abs(brand.length - cleaned.length) > cap) continue;
    if (levenshtein(cleaned, brand, cap) <= cap) return true;
  }
  return false;
}

export function filterCandidates(
  names: string[],
  options: PhoneticFilterOptions = {},
): FilterOutcome {
  const enabled = {
    consonantPileup: flag("PHONETIC_FILTER_CONSONANT_PILEUP", true),
    suffixCliche: flag(
      "PHONETIC_FILTER_SUFFIX_CLICHE",
      options.wordTypeConstraint !== "dictionary",
    ),
    prefixCliche: flag("PHONETIC_FILTER_PREFIX_CLICHE", true),
    categoryCliche: flag("PHONETIC_FILTER_CATEGORY_CLICHE", true),
    majorBrandCollision: flag("PHONETIC_FILTER_MAJOR_BRAND", true),
  };

  const kept: string[] = [];
  const dropped: Array<{ name: string; reason: FilterRejectionReason }> = [];
  const droppedByReason = emptyReasonCounts();
  const seen = new Set<string>();

  for (const raw of names) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) {
      droppedByReason.empty += 1;
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const cleaned = normalized.replace(/[^a-z]/g, "");
    if (cleaned.length < 3) {
      droppedByReason.tooShort += 1;
      dropped.push({ name: trimmed, reason: "tooShort" });
      continue;
    }

    if (enabled.consonantPileup && hasConsonantPileup(trimmed)) {
      droppedByReason.consonantPileup += 1;
      dropped.push({ name: trimmed, reason: "consonantPileup" });
      continue;
    }
    if (enabled.suffixCliche && endsInSuffixCliche(trimmed)) {
      droppedByReason.suffixCliche += 1;
      dropped.push({ name: trimmed, reason: "suffixCliche" });
      continue;
    }
    if (enabled.prefixCliche && startsWithPrefixCliche(trimmed)) {
      droppedByReason.prefixCliche += 1;
      dropped.push({ name: trimmed, reason: "prefixCliche" });
      continue;
    }
    if (
      enabled.categoryCliche &&
      containsCategoryCliche(
        trimmed,
        options.industry,
        options.brief?.cliches ?? [],
      )
    ) {
      droppedByReason.categoryCliche += 1;
      dropped.push({ name: trimmed, reason: "categoryCliche" });
      continue;
    }
    if (enabled.majorBrandCollision && looksLikeMajorBrand(trimmed)) {
      droppedByReason.majorBrandCollision += 1;
      dropped.push({ name: trimmed, reason: "majorBrandCollision" });
      continue;
    }

    kept.push(trimmed);
  }

  return { kept, dropped, droppedByReason };
}
