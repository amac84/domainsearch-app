import { getIndustryGuidance, getCombinedStyleGuidance, getCombinedToneGuidance } from "@/lib/name-generation";
import { getJudgeClient, getJudgeModel } from "@/lib/llm-clients";
import type { EnrichedBrief, NameCandidate, NameRecommendation } from "@/types";
import { logError, logWarn } from "@/lib/server-logger";

const DEFAULT_MAX_TO_RANK = 80;

export interface QualityRankInput {
  description: string;
  industry?: string;
  tone?: string | string[];
  nameStyle?: string | string[];
  referenceSeoSummary?: string;
  referenceSeoKeywords?: string[];
  names: NameCandidate[];
  maxToRank?: number;
  /** v2 pipeline: structured brief used to keep judging aligned with generation. */
  brief?: EnrichedBrief;
  /**
   * v2 pipeline: when names are tagged by territory, balance the top
   * recommendations so no more than `maxPerTerritory` come from one territory.
   */
  maxRecommendationsPerTerritory?: number;
}

export interface QualityRankResult {
  rankedBases: string[];
  rationales: Record<string, string>;
  summary: string;
  recommendations: NameRecommendation[];
}

export async function runQualityRanking(
  input: QualityRankInput,
): Promise<QualityRankResult | null> {
  const maxToRank = Math.min(Math.max(input.maxToRank ?? DEFAULT_MAX_TO_RANK, 10), 120);
  const candidates = input.names.slice(0, maxToRank);
  if (candidates.length === 0) {
    return null;
  }

  const candidatesForPrompt = candidates.map((name) => ({
    base: name.base,
    domains: name.domains.map((domain) => ({
      domain: domain.domain,
      available: domain.available,
    })),
    heuristicScore: name.score,
    territory: name.territory,
  }));

  const brief = input.brief;
  const model = getJudgeModel();
  const maxPerTerritory = Math.max(1, input.maxRecommendationsPerTerritory ?? 2);
  const completion = await getJudgeClient().chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: [
          "You are an expert brand naming strategist and growth marketer. Judge names with the same Lunour-style criteria as generation: evocative, memorable, spellable, speakable, ownable, scalable, domain-viable.",
          "Evaluate generated brand names by quality, memorability, pronounceability, and fit to the brand description, industry, and tone below.",
          "Use only the provided names and domain availability. Do not invent new names.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Brand description: ${input.description}`,
          brief ? `Positioning: ${brief.positioning}` : "",
          brief ? `Primary audience: ${brief.primaryAudience}` : "",
          brief ? `Emotional north star: ${brief.emotionalNorthStar}` : "",
          brief && brief.personalityAdjectives.length
            ? `Personality: ${brief.personalityAdjectives.join(", ")}`
            : "",
          brief && brief.antiPositioning.length
            ? `Anti-positioning (we are NOT these): ${brief.antiPositioning.join(", ")}`
            : "",
          input.referenceSeoSummary
            ? `Reference SEO summary: ${input.referenceSeoSummary}`
            : "",
          input.referenceSeoKeywords?.length
            ? `Reference SEO keywords: ${input.referenceSeoKeywords.join(", ")}`
            : "",
          `Industry: ${input.industry || "unspecified"}. ${getIndustryGuidance(input.industry)}`,
          "Tone and style (use this when judging fit):",
          `Vibe(s): ${Array.isArray(input.tone) ? input.tone.join(", ") : input.tone || "balanced"}. ${getCombinedToneGuidance(input.tone)}`,
          `Archetype(s): ${Array.isArray(input.nameStyle) ? input.nameStyle.join(", ") : input.nameStyle || "evocative"}. ${getCombinedStyleGuidance(input.nameStyle)}`,
          "Task:",
          "1) Rank names by overall quality (brand fit, memorability, pronounceability) and SEO/discoverability fit for this brand context.",
          "2) Provide one concise rationale per ranked name.",
          "3) Provide a short summary conclusion (2-3 sentences).",
          `4) Provide top recommendations (5-10) with short reasons. When names are tagged by territory, balance picks across territories (max ${maxPerTerritory} recommendations per territory).`,
          "",
          `Candidates JSON: ${JSON.stringify(candidatesForPrompt)}`,
        ].join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "quality_ranking",
        schema: {
          type: "object",
          properties: {
            rankedBases: {
              type: "array",
              items: { type: "string" },
            },
            rationales: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            summary: { type: "string" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  base: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["base", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["rankedBases", "rationales", "summary", "recommendations"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    logWarn("quality_ranking.empty_response_content", {
      model,
      candidateCount: candidates.length,
    });
    return null;
  }

  try {
    const parsed = JSON.parse(content) as {
      rankedBases?: unknown;
      rationales?: unknown;
      summary?: unknown;
      recommendations?: unknown;
    };

    if (
      !Array.isArray(parsed.rankedBases) ||
      typeof parsed.summary !== "string" ||
      !parsed.summary.trim() ||
      typeof parsed.rationales !== "object" ||
      parsed.rationales === null ||
      !Array.isArray(parsed.recommendations)
    ) {
      logWarn("quality_ranking.invalid_response_shape", {
        model,
        candidateCount: candidates.length,
      });
      return null;
    }

    const validBases = new Set(candidates.map((candidate) => candidate.base));
    const rankedBases = parsed.rankedBases.filter(
      (value): value is string =>
        typeof value === "string" && validBases.has(value),
    );

    const rationales: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.rationales as Record<string, unknown>)) {
      if (typeof value === "string" && validBases.has(key)) {
        rationales[key] = value;
      }
    }

    const recommendations: NameRecommendation[] = parsed.recommendations
      .filter(
        (value): value is { base: string; reason: string } =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { base?: unknown }).base === "string" &&
          typeof (value as { reason?: unknown }).reason === "string" &&
          validBases.has((value as { base: string }).base),
      )
      .slice(0, 10)
      .map((item) => ({ base: item.base, reason: item.reason }));

    return {
      rankedBases,
      rationales,
      summary: parsed.summary.trim(),
      recommendations,
    };
  } catch (error) {
    logError("quality_ranking.parse_failed", error, {
      model,
      candidateCount: candidates.length,
    });
    return null;
  }
}
