import OpenAI from "openai";

import { getIndustryGuidance, getToneGuidance } from "@/lib/name-generation";
import type { NameCandidate, NameRecommendation } from "@/types";
import { logError, logWarn } from "@/lib/server-logger";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const DEFAULT_MAX_TO_RANK = 80;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export interface QualityRankInput {
  description: string;
  industry?: string;
  tone?: string;
  referenceSeoSummary?: string;
  referenceSeoKeywords?: string[];
  names: NameCandidate[];
  maxToRank?: number;
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
  }));

  const completion = await getClient().chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: [
          "You are an expert brand strategist and growth marketer.",
          "Evaluate generated brand names by quality, memorability, pronounceability, and fit to the brand description, industry, and tone below.",
          "Use only the provided names and domain availability. Do not invent new names.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Brand description: ${input.description}`,
          input.referenceSeoSummary
            ? `Reference SEO summary: ${input.referenceSeoSummary}`
            : "",
          input.referenceSeoKeywords?.length
            ? `Reference SEO keywords: ${input.referenceSeoKeywords.join(", ")}`
            : "",
          `Industry: ${input.industry || "unspecified"}. ${getIndustryGuidance(input.industry)}`,
          "Tone and style (use this when judging fit):",
          `Tone: ${input.tone || "balanced"}. ${getToneGuidance(input.tone)}`,
          "Task:",
          "1) Rank names by overall quality (brand fit, memorability, pronounceability) and SEO/discoverability fit for this brand context.",
          "2) Provide one concise rationale per ranked name.",
          "3) Provide a short summary conclusion (2-3 sentences).",
          "4) Provide top recommendations (5-10) with short reasons.",
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
      model: DEFAULT_MODEL,
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
        model: DEFAULT_MODEL,
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
      model: DEFAULT_MODEL,
      candidateCount: candidates.length,
    });
    return null;
  }
}
