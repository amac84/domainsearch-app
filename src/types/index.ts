/**
 * Lunour-style brand "feelings" the user wants the name to evoke.
 * Source: Phase 1 discovery question from `lunour-naming.skill`.
 */
export type Tone =
  | "trust"
  | "delight"
  | "power"
  | "safety"
  | "curiosity"
  | "calm"
  | "warmth"
  | "precision"
  | "mystery"
  | "other";

/**
 * Lunour naming archetypes (from `references/naming-types.md` in `lunour-naming.skill`).
 * Founder/eponymous and number/symbol are intentionally excluded as user-pickable
 * options because they require external context to choose well.
 */
export type NameStyle =
  | "evocative"
  | "invented"
  | "metaphor"
  | "experiential"
  | "portmanteau"
  | "abstract"
  | "place"
  | "descriptive";

export type WordConstraint = "oneWord" | "twoWord";
export type SyllableConstraint = "any" | "two";
export type WordTypeConstraint = "mixed" | "invented" | "dictionary";

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
  scoreBreakdown?: NameScoreBreakdown;
  rationale?: string;
}

export interface NameScoreBreakdown {
  brandability: number;
  pronounceability: number;
  length: number;
  aiVibe: number;
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
  scoreBreakdown?: NameScoreBreakdown;
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
  tone?: Tone | string | string[];
  nameStyle?: NameStyle | string | string[];
  wordConstraint?: WordConstraint;
  syllableConstraint?: SyllableConstraint;
  wordTypeConstraint?: WordTypeConstraint;
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
  meta: GenerateMeta;
}

export interface GenerateMeta {
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
  /** Set when the domain availability API failed for every request in a batch (e.g. 503). */
  domainLookupError?: string;
}

export interface SearchHistoryEntry {
  id: string;
  createdAt: string; // ISO
  query: string;
  tone: string;
  nameStyle: string;
  tlds: string[];
  refined: boolean;
  resultCount: number;
  availableCount: number;
  names: NameCandidate[];
  meta: GenerateMeta;
}

export type FeedbackIssueStatus =
  | "submitted"
  | "linked"
  | "fixed"
  | "closed_no_fix"
  | "unlinked";

export interface FeedbackSubmission {
  id: string;
  userId: string;
  title: string;
  description: string;
  submittedAt: string;
  linearIssueId?: string;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
  linearIssueStateName?: string;
  linearIssueStateType?: string;
  issueStatus: FeedbackIssueStatus;
  fixedAt?: string;
  acknowledgedAt?: string;
}

export interface NameGenerationInput {
  description: string;
  referenceDomain?: string;
  referenceSeoSummary?: string;
  referenceSeoKeywords?: string[];
  industry?: string;
  tone?: string | string[];
  nameStyle?: string | string[];
  wordConstraint?: WordConstraint;
  syllableConstraint?: SyllableConstraint;
  wordTypeConstraint?: WordTypeConstraint;
  maxLength: number;
  maxSyllables: number;
  avoidDictionaryWords: boolean;
  avoidWords: string[];
  temperature: number;
  count: number;
  refineFrom?: RefinementInputName[];
  prioritizePremiumTlds?: string[];
  /**
   * Bases the model has already produced in earlier rounds (or in the parent
   * search when refining). The prompt instructs the model NOT to re-emit any
   * of these, and the pipeline post-filters duplicates as defence in depth.
   */
  avoidBases?: string[];
}
