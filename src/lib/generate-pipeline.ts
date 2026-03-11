import { checkDomains } from "@/lib/domain-checker";
import { buildDomainsForNames, normalizeBaseNames } from "@/lib/domain-utils";
import { generateNames } from "@/lib/name-generation";
import { runQualityRanking } from "@/lib/quality-rank";
import { summarizeReferenceDomain } from "@/lib/reference-site-summary";
import { rankCandidates } from "@/lib/ranking";
import { logError, logInfo, logWarn } from "@/lib/server-logger";
import type {
  DomainResult,
  GenerateRequestBody,
  GenerateResponseBody,
  NameCandidate,
  NameGenerationInput,
  RefinementInputName,
} from "@/types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toGenerationInput(
  body: GenerateRequestBody,
  refineFrom?: RefinementInputName[],
  prioritizePremiumTlds?: string[],
  referenceSeoContext?: {
    summary?: string;
    keywords?: string[];
  },
): NameGenerationInput {
  return {
    description: body.description,
    referenceDomain: body.referenceDomain,
    referenceSeoSummary: referenceSeoContext?.summary,
    referenceSeoKeywords: referenceSeoContext?.keywords,
    industry: body.industry,
    tone: body.tone,
    maxLength: clamp(body.maxLength ?? 10, 4, 20),
    maxSyllables: clamp(body.maxSyllables ?? 3, 1, 6),
    avoidDictionaryWords: Boolean(body.avoidDictionaryWords),
    avoidWords: body.avoidWords?.filter(Boolean).slice(0, 20) ?? [],
    temperature: clamp(body.temperature ?? 0.7, 0.3, 1.2),
    count: clamp(body.count ?? 100, 50, 200),
    refineFrom,
    prioritizePremiumTlds,
  };
}

function availabilityRateFromNames(names: NameCandidate[]): number {
  let total = 0;
  let available = 0;
  for (const name of names) {
    for (const domain of name.domains) {
      total += 1;
      if (domain.available) {
        available += 1;
      }
    }
  }
  return total === 0 ? 0 : available / total;
}

function countExactAvailableByTld(names: NameCandidate[], tld: string): number {
  const normalizedTld = tld.toLowerCase().replace(/^\.+/, "");
  return names.filter((candidate) =>
    candidate.domains.some(
      (domain) =>
        domain.available && domain.domain === `${candidate.base}.${normalizedTld}`,
    ),
  ).length;
}

function countPremiumAvailable(
  names: NameCandidate[],
  premiumTlds: string[],
): number {
  return names.filter((candidate) =>
    premiumTlds.some((tld) =>
      candidate.domains.some(
        (domain) =>
          domain.available && domain.domain === `${candidate.base}.${tld}`,
      ),
    ),
  ).length;
}

function hasAllSelectedTldsAvailable(
  candidate: NameCandidate,
  selectedTlds: string[],
): boolean {
  const normalized = selectedTlds.map((t) => t.toLowerCase().replace(/^\.+/, ""));
  return normalized.every((tld) =>
    candidate.domains.some(
      (d) => d.domain === `${candidate.base}.${tld}` && d.available,
    ),
  );
}

export function namesWithAtLeastOneTld(
  candidates: NameCandidate[],
  selectedTlds: string[],
): NameCandidate[] {
  const normalized = selectedTlds.map((t) => t.toLowerCase().replace(/^\.+/, ""));
  return candidates.filter((c) =>
    normalized.some((tld) =>
      c.domains.some(
        (d) => d.domain === `${c.base}.${tld}` && d.available,
      ),
    ),
  );
}

function reorderWithRationales(
  names: NameCandidate[],
  rankedBases: string[],
  rationales: Record<string, string>,
): NameCandidate[] {
  const order = new Map<string, number>();
  rankedBases.forEach((base, index) => order.set(base, index));

  return [...names]
    .sort((a, b) => {
      const orderA = order.get(a.base);
      const orderB = order.get(b.base);
      if (orderA == null && orderB == null) return b.score - a.score;
      if (orderA == null) return 1;
      if (orderB == null) return -1;
      return orderA - orderB;
    })
    .map((candidate) => ({
      ...candidate,
      rationale: rationales[candidate.base],
    }));
}

async function buildNameCandidates(
  names: string[],
  request: GenerateRequestBody,
): Promise<NameCandidate[]> {
  const normalizedNames = normalizeBaseNames(names, request.maxLength ?? 10);
  const domainPairs = buildDomainsForNames(normalizedNames, {
    tlds: request.tlds,
    includePrefixVariants: request.includePrefixVariants,
  });
  const checkedDomains = await checkDomains(
    domainPairs.map((pair) => pair.domain),
    {
      baseUrl: process.env.AGENT_DOMAIN_SERVICE_URL ?? "https://agentdomainservice.com",
      endpointPath:
        process.env.AGENT_DOMAIN_SERVICE_CHECK_PATH ?? "/api/lookup/{base}",
      ttlSeconds: Number(process.env.DOMAIN_CHECK_CACHE_TTL_SECONDS ?? "21600"),
      concurrency: Number(process.env.DOMAIN_CHECK_CONCURRENCY ?? "15"),
    },
  );

  const groupedByBase = new Map<string, DomainResult[]>();
  for (const pair of domainPairs) {
    const existing = groupedByBase.get(pair.base) ?? [];
    const result = checkedDomains.get(pair.domain);
    if (result) {
      existing.push(result);
    }
    groupedByBase.set(pair.base, existing);
  }

  const unranked: NameCandidate[] = Array.from(groupedByBase.entries()).map(
    ([base, domains]) => ({
      base,
      domains,
      score: 0,
    }),
  );
  return rankCandidates(unranked);
}

const PREMIUM_TLDS = ["com", "ai"];
const MIN_PREMIUM_TARGET_DEFAULT = 5;
const MAX_PREMIUM_REFINEMENT_ROUNDS = 8;
const QUALITY_PASS_THRESHOLD = 30;

function countWithAllSelectedTlds(
  names: NameCandidate[],
  selectedTlds: string[],
): number {
  const normalized = selectedTlds.map((t) => t.toLowerCase().replace(/^\.+/, ""));
  return names.filter((c) =>
    normalized.every((tld) =>
      c.domains.some(
        (d) => d.domain === `${c.base}.${tld}` && d.available,
      ),
    ),
  ).length;
}

export interface PipelineResult {
  generatedNames: NameCandidate[];
  names: NameCandidate[];
  namesBeforeTldFilter: NameCandidate[];
  refinementRounds: number;
  checkedDomains: number;
  comAvailableCount: number;
  aiAvailableCount: number;
  premiumAvailableCount: number;
  summary?: string;
  recommendations?: GenerateResponseBody["meta"]["recommendations"];
}

type ProgressCallback = (message: string) => void;
type LogContext = Record<string, unknown>;

async function runGenerationPipeline(
  body: GenerateRequestBody,
  referenceSeoContext: {
    summary?: string;
    keywords?: string[];
  } | null,
  onProgress?: ProgressCallback,
  logContext: LogContext = {},
): Promise<{ names: NameCandidate[]; refinementRounds: number }> {
  const selectedTlds = body.tlds.map((t) => t.toLowerCase().replace(/^\.+/, ""));
  const selectedPremiumTlds = PREMIUM_TLDS.filter((tld) =>
    selectedTlds.includes(tld),
  );
  const wantsPremiumTld = selectedPremiumTlds.length > 0;
  const minPremiumTarget = Math.max(
    0,
    body.minPremiumTarget ?? body.minComTarget ?? MIN_PREMIUM_TARGET_DEFAULT,
  );

  const firstPassInput = toGenerationInput(
    body,
    body.refineFrom?.namesWithAvailability,
    undefined,
    referenceSeoContext ?? undefined,
  );
  onProgress?.("Generating first batch of names…");
  logInfo("pipeline.first_pass.start", {
    ...logContext,
    requestedCount: firstPassInput.count,
    temperature: firstPassInput.temperature,
  });
  const firstPassNames = await generateNames(firstPassInput);
  logInfo("pipeline.first_pass.generated", {
    ...logContext,
    generatedCount: firstPassNames.length,
  });
  onProgress?.(`Generated ${firstPassNames.length} names. Checking domain availability…`);
  let ranked = await buildNameCandidates(firstPassNames, body);
  logInfo("pipeline.first_pass.rank_complete", {
    ...logContext,
    candidateCount: ranked.length,
    availabilityRate: availabilityRateFromNames(ranked),
  });
  onProgress?.("Ranking and filtering names…");
  let refinementRounds = 0;

  const countAllTlds = (): number =>
    countWithAllSelectedTlds(ranked, selectedTlds);

  const needsMoreNames =
    !body.refineFrom &&
    (availabilityRateFromNames(ranked) < 0.1 || countAllTlds() < 1);

  if (needsMoreNames) {
    logWarn("pipeline.low_availability.second_pass", {
      ...logContext,
      availabilityRate: availabilityRateFromNames(ranked),
      allSelectedTldMatches: countAllTlds(),
    });
    onProgress?.("Low availability. Generating second batch with adjusted criteria…");
    const secondPassInput = {
      ...toGenerationInput(
        body,
        ranked.map((item) => ({
          base: item.base,
          domains: item.domains.map((d) => ({ domain: d.domain, available: d.available })),
        })),
        selectedPremiumTlds,
        referenceSeoContext ?? undefined,
      ),
      temperature: 0.95,
      count: Math.min(firstPassInput.count, 80),
    };
    const secondPassNames = await generateNames(secondPassInput);
    logInfo("pipeline.second_pass.generated", {
      ...logContext,
      generatedCount: secondPassNames.length,
      temperature: secondPassInput.temperature,
    });
    onProgress?.("Checking availability for second batch…");
    const secondPassRanked = await buildNameCandidates(secondPassNames, body);
    ranked = rankCandidates([...ranked, ...secondPassRanked]);
    logInfo("pipeline.second_pass.rank_complete", {
      ...logContext,
      candidateCount: ranked.length,
      availabilityRate: availabilityRateFromNames(ranked),
    });
    refinementRounds = 1;
  }

  const requireAllTlds = Boolean(body.requireAllTlds);
  const hasEnoughNames = (): boolean =>
    requireAllTlds
      ? countAllTlds() >= 1
      : namesWithAtLeastOneTld(ranked, selectedTlds).length >= 1;

  let round = refinementRounds;
  while (!hasEnoughNames() && round < MAX_PREMIUM_REFINEMENT_ROUNDS) {
    const isPremiumRefine = wantsPremiumTld && minPremiumTarget > 0 &&
      countPremiumAvailable(ranked, selectedPremiumTlds) < minPremiumTarget;
    onProgress?.(
      isPremiumRefine
        ? `Refining for more .com/.ai (round ${round + 1})…`
        : `Need more names with ${requireAllTlds ? "all" : "at least one"} selected TLD. Generating more (round ${round + 1})…`,
    );
    const refinementInput = ranked.map((item) => ({
      base: item.base,
      domains: item.domains.map((d) => ({ domain: d.domain, available: d.available })),
    }));
    const nextInput = {
      ...toGenerationInput(
        body,
        refinementInput,
        selectedPremiumTlds,
        referenceSeoContext ?? undefined,
      ),
      count: Math.min(firstPassInput.count, 60),
      temperature: 0.85,
    };
    const nextNames = await generateNames(nextInput);
    logInfo("pipeline.refinement.generated", {
      ...logContext,
      round: round + 1,
      generatedCount: nextNames.length,
      selectedTlds,
      requireAllTlds,
    });
    onProgress?.("Checking availability for refinement batch…");
    const nextRanked = await buildNameCandidates(nextNames, body);
    ranked = rankCandidates([...ranked, ...nextRanked]);
    logInfo("pipeline.refinement.rank_complete", {
      ...logContext,
      round: round + 1,
      candidateCount: ranked.length,
      premiumAvailableCount: countPremiumAvailable(ranked, selectedPremiumTlds),
      allSelectedTldMatches: countAllTlds(),
    });
    round += 1;
  }
  refinementRounds = round;

  return { names: ranked, refinementRounds };
}

export async function runFullPipeline(
  body: GenerateRequestBody,
  onProgress?: ProgressCallback,
  logContext: LogContext = {},
): Promise<PipelineResult> {
  const selectedTlds = body.tlds.map((t) => t.toLowerCase().replace(/^\.+/, ""));
  logInfo("pipeline.run.start", {
    ...logContext,
    selectedTlds,
    requireAllTlds: Boolean(body.requireAllTlds),
    requestedCount: body.count ?? 100,
  });
  let referenceSeoContext: { summary?: string; keywords?: string[] } | null = null;
  if (body.referenceDomain?.trim()) {
    onProgress?.("Analyzing reference domain for SEO signals…");
    try {
      const seoSummary = await summarizeReferenceDomain(body.referenceDomain);
      if (seoSummary) {
        referenceSeoContext = {
          summary: seoSummary.summary,
          keywords: seoSummary.keywords,
        };
        logInfo("pipeline.reference_domain.summary_ready", {
          ...logContext,
          referenceDomain: seoSummary.domain,
          sourceUrl: seoSummary.sourceUrl,
          keywordCount: seoSummary.keywords.length,
        });
      } else {
        logWarn("pipeline.reference_domain.unavailable", {
          ...logContext,
          referenceDomain: body.referenceDomain,
        });
      }
    } catch (error) {
      logError("pipeline.reference_domain.failed", error, {
        ...logContext,
        referenceDomain: body.referenceDomain,
      });
    }
  }

  const { names: generatedNames, refinementRounds } = await runGenerationPipeline(
    body,
    referenceSeoContext,
    onProgress,
    logContext,
  );
  const checkedDomains = generatedNames.reduce(
    (acc, value) => acc + value.domains.length,
    0,
  );
  const comAvailableCount = countExactAvailableByTld(generatedNames, "com");
  const aiAvailableCount = countExactAvailableByTld(generatedNames, "ai");
  const premiumAvailableCount = countPremiumAvailable(generatedNames, PREMIUM_TLDS);
  let names = generatedNames;
  let summary: string | undefined;
  let recommendations: GenerateResponseBody["meta"]["recommendations"];

  if (generatedNames.length >= QUALITY_PASS_THRESHOLD) {
    onProgress?.("Running quality ranking and recommendations…");
    const quality = await runQualityRanking({
      description: body.description,
      industry: body.industry,
      tone: body.tone,
      referenceSeoSummary: referenceSeoContext?.summary,
      referenceSeoKeywords: referenceSeoContext?.keywords,
      names: generatedNames,
    });

    if (quality) {
      names = reorderWithRationales(
        generatedNames,
        quality.rankedBases,
        quality.rationales,
      );
      summary = quality.summary;
      recommendations = quality.recommendations;
      logInfo("pipeline.quality_ranking.applied", {
        ...logContext,
        rankedBases: quality.rankedBases.length,
        recommendationCount: quality.recommendations.length,
      });
    } else {
      logWarn("pipeline.quality_ranking.empty", {
        ...logContext,
        generatedCount: generatedNames.length,
      });
    }
  }

  onProgress?.("Filtering by selected TLDs…");
  const namesBeforeTldFilter = names;
  const requireAllTlds = Boolean(body.requireAllTlds);
  names = requireAllTlds
    ? names.filter((c) => hasAllSelectedTldsAvailable(c, selectedTlds))
    : namesWithAtLeastOneTld(names, selectedTlds);
  if (recommendations?.length) {
    const allowedBases = new Set(names.map((c) => c.base));
    recommendations = recommendations.filter((rec) => allowedBases.has(rec.base));
  }

  logInfo("pipeline.run.complete", {
    ...logContext,
    generatedCount: generatedNames.length,
    resultCount: names.length,
    checkedDomains,
    comAvailableCount,
    aiAvailableCount,
    premiumAvailableCount,
    refinementRounds,
    requireAllTlds,
  });

  return {
    generatedNames,
    names,
    namesBeforeTldFilter,
    refinementRounds,
    checkedDomains,
    comAvailableCount,
    aiAvailableCount,
    premiumAvailableCount,
    summary,
    recommendations,
  };
}

export type FallbackStrategy = {
  id: string;
  modify: (body: GenerateRequestBody) => GenerateRequestBody | null;
};

export const FALLBACK_STRATEGIES: FallbackStrategy[] = [
  {
    id: "allowDictionaryWords",
    modify: (b) =>
      b.avoidDictionaryWords ? { ...b, avoidDictionaryWords: false } : null,
  },
  {
    id: "increaseSyllables",
    modify: (b) => {
      const current = b.maxSyllables ?? 3;
      return current < 6 ? { ...b, maxSyllables: Math.min(6, current + 1) } : null;
    },
  },
  {
    id: "increaseLength",
    modify: (b) => {
      const current = b.maxLength ?? 10;
      return current < 20 ? { ...b, maxLength: Math.min(20, current + 2) } : null;
    },
  },
  {
    id: "higherTemperature",
    modify: (b) => ({ ...b, temperature: 0.95 }),
  },
  {
    id: "fewerAvoidWords",
    modify: (b) => {
      const words = b.avoidWords?.filter(Boolean) ?? [];
      if (words.length === 0) return null;
      const half = Math.max(1, Math.ceil(words.length / 2));
      return { ...b, avoidWords: words.slice(0, half) };
    },
  },
];

export function buildResponse(
  result: PipelineResult,
  body: GenerateRequestBody,
  metaOverrides: { fallbackUsed?: string; relaxedTldFilter?: boolean } = {},
): GenerateResponseBody {
  const recommendations =
    result.recommendations?.filter((rec) =>
      result.names.some((c) => c.base === rec.base),
    );
  return {
    names: result.names,
    meta: {
      generatedCount: result.generatedNames.length,
      checkedDomains: result.checkedDomains,
      availabilityRate: availabilityRateFromNames(result.generatedNames),
      refined: Boolean(body.refineFrom),
      comAvailableCount: result.comAvailableCount,
      aiAvailableCount: result.aiAvailableCount,
      premiumAvailableCount: result.premiumAvailableCount,
      refinementRounds: result.refinementRounds,
      summary: result.summary,
      recommendations,
      ...metaOverrides,
    },
  };
}
