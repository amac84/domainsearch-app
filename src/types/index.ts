export type Tone =
  | "bold"
  | "technical"
  | "playful"
  | "premium"
  | "professional"
  | "modern"
  | "minimal"
  | "other";

export type DomainStatus = "available" | "taken" | "error";

export interface DomainResult {
  domain: string;
  available: boolean;
  status: DomainStatus;
  premium?: boolean;
  /** Price in USD when domain is premium/for sale (from API). */
  price?: number;
  source: "cache" | "api";
}

export interface NameCandidate {
  base: string;
  domains: DomainResult[];
  score: number;
  rationale?: string;
}

export interface NameRecommendation {
  base: string;
  reason: string;
}

/** A name saved by the user, including generation context (summary + rationale). */
export interface SavedName {
  id: string;
  base: string;
  domains: DomainResult[];
  rationale?: string;
  score: number;
  /** Run-level summary conclusion from the generation that produced this name. */
  summaryConclusion?: string;
  /** Top-recommendation reason if this name was in meta.recommendations. */
  recommendationReason?: string;
  savedAt: string; // ISO
}

export interface RefinementInputName {
  base: string;
  domains: Array<{
    domain: string;
    available: boolean;
  }>;
}

export interface GenerateRequestBody {
  description: string;
  referenceDomain?: string;
  industry?: string;
  tone?: Tone | string;
  maxLength?: number;
  maxSyllables?: number;
  avoidDictionaryWords?: boolean;
  avoidWords?: string[];
  tlds: string[];
  temperature?: number;
  count?: number;
  includePrefixVariants?: boolean;
  refineFrom?: {
    namesWithAvailability: RefinementInputName[];
  };
  /** Legacy field: kept for compatibility with existing clients. */
  minComTarget?: number;
  /** When .com/.ai are selected, keep generating until this many names have .com or .ai available. */
  minPremiumTarget?: number;
  /** If true, only show names where every selected TLD is available. If false (default), show names that have at least one selected TLD. */
  requireAllTlds?: boolean;
}

export interface GenerateResponseBody {
  names: NameCandidate[];
  meta: {
    generatedCount: number;
    checkedDomains: number;
    availabilityRate: number;
    refined: boolean;
    comAvailableCount?: number;
    aiAvailableCount?: number;
    premiumAvailableCount?: number;
    refinementRounds?: number;
    summary?: string;
    recommendations?: NameRecommendation[];
    /** Set when zero results triggered a fallback run with relaxed params. */
    fallbackUsed?: string;
    /** True when results show names with at least one selected TLD (none had all). */
    relaxedTldFilter?: boolean;
  };
}

export interface NameGenerationInput {
  description: string;
  referenceDomain?: string;
  referenceSeoSummary?: string;
  referenceSeoKeywords?: string[];
  industry?: string;
  tone?: string;
  maxLength: number;
  maxSyllables: number;
  avoidDictionaryWords: boolean;
  avoidWords: string[];
  temperature: number;
  count: number;
  refineFrom?: RefinementInputName[];
  prioritizePremiumTlds?: string[];
}
