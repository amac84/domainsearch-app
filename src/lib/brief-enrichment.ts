import { createHash } from "node:crypto";

import { getJudgeClient, getJudgeModel } from "@/lib/llm-clients";
import {
  getCombinedStyleGuidance,
  getCombinedToneGuidance,
  getIndustryGuidance,
} from "@/lib/name-generation";
import { logError, logWarn } from "@/lib/server-logger";
import type { EnrichedBrief, GenerateRequestBody } from "@/types";

/**
 * Phase 1 of the v2 pipeline: turn a thin user brief into a structured
 * creative brief a naming agency would work from. This runs invisibly before
 * generation and is threaded through every downstream step so strategy,
 * generation, critique, and judging all share the same north star.
 *
 * Cached per-process by hash of the relevant inputs so repeat runs don't pay
 * the token cost a second time.
 */

export interface EnrichBriefInputs {
  body: Pick<
    GenerateRequestBody,
    "description" | "industry" | "tone" | "nameStyle" | "referenceDomain"
  >;
  referenceSeoSummary?: string;
  referenceSeoKeywords?: string[];
}

const CACHE_MAX_ENTRIES = 128;
const cache = new Map<string, EnrichedBrief>();

function cacheKey(inputs: EnrichBriefInputs): string {
  const payload = {
    d: inputs.body.description?.trim().toLowerCase() ?? "",
    i: inputs.body.industry?.trim().toLowerCase() ?? "",
    t: Array.isArray(inputs.body.tone)
      ? [...inputs.body.tone].sort().join("|")
      : inputs.body.tone ?? "",
    s: Array.isArray(inputs.body.nameStyle)
      ? [...inputs.body.nameStyle].sort().join("|")
      : inputs.body.nameStyle ?? "",
    r: inputs.body.referenceDomain?.trim().toLowerCase() ?? "",
    seo: inputs.referenceSeoSummary?.trim() ?? "",
    kw: (inputs.referenceSeoKeywords ?? []).join(","),
  };
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function cachePut(key: string, value: EnrichedBrief): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey != null) cache.delete(firstKey);
  }
  cache.set(key, value);
}

function toneLabel(tone: GenerateRequestBody["tone"]): string {
  if (Array.isArray(tone)) return tone.filter(Boolean).join(", ") || "trust";
  return tone || "trust";
}

function styleLabel(style: GenerateRequestBody["nameStyle"]): string {
  if (Array.isArray(style)) return style.filter(Boolean).join(", ") || "evocative";
  return style || "evocative";
}

const BRIEF_SCHEMA = {
  name: "enriched_brief",
  schema: {
    type: "object",
    properties: {
      positioning: { type: "string" },
      primaryAudience: { type: "string" },
      secondaryAudience: { type: "string" },
      personalityAdjectives: {
        type: "array",
        items: { type: "string" },
        maxItems: 3,
      },
      emotionalNorthStar: { type: "string" },
      antiPositioning: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
      },
      territoriesShortlist: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
      },
      avoidWordsInferred: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
      },
      cliches: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
      },
    },
    required: [
      "positioning",
      "primaryAudience",
      "personalityAdjectives",
      "emotionalNorthStar",
      "antiPositioning",
      "territoriesShortlist",
      "avoidWordsInferred",
      "cliches",
    ],
    additionalProperties: false,
  },
} as const;

function sanitizeStringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

function normalizeBrief(raw: unknown): EnrichedBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const positioning = typeof data.positioning === "string" ? data.positioning.trim() : "";
  const primaryAudience =
    typeof data.primaryAudience === "string" ? data.primaryAudience.trim() : "";
  const emotionalNorthStar =
    typeof data.emotionalNorthStar === "string" ? data.emotionalNorthStar.trim() : "";

  if (!positioning || !primaryAudience || !emotionalNorthStar) return null;

  const secondaryAudience =
    typeof data.secondaryAudience === "string" && data.secondaryAudience.trim()
      ? data.secondaryAudience.trim()
      : undefined;

  return {
    positioning,
    primaryAudience,
    secondaryAudience,
    personalityAdjectives: sanitizeStringArray(data.personalityAdjectives, 3),
    emotionalNorthStar,
    antiPositioning: sanitizeStringArray(data.antiPositioning, 5),
    territoriesShortlist: sanitizeStringArray(data.territoriesShortlist, 5),
    avoidWordsInferred: sanitizeStringArray(data.avoidWordsInferred, 20),
    cliches: sanitizeStringArray(data.cliches, 20),
  };
}

export async function enrichBrief(
  inputs: EnrichBriefInputs,
): Promise<EnrichedBrief | null> {
  const key = cacheKey(inputs);
  const cached = cache.get(key);
  if (cached) return cached;

  const { body, referenceSeoSummary, referenceSeoKeywords } = inputs;
  if (!body.description?.trim()) return null;

  const toneValue = toneLabel(body.tone);
  const styleValue = styleLabel(body.nameStyle);

  const system = [
    "You are the strategy director at a premium naming agency (think Lexicon, Pentagram).",
    "Your job is NOT to produce names. Your job is to turn a thin brief into a precise, structured creative brief the naming team will work from.",
    "Be specific, concrete, and opinionated. Avoid corporate boilerplate and generic language.",
    "Infer missing context from the product description, industry, and tone. Default to plausible, commercially credible choices when inputs are thin.",
  ].join(" ");

  const user = [
    "Raw user inputs:",
    `- Description: ${body.description.trim()}`,
    `- Industry: ${body.industry?.trim() || "unspecified"}`,
    `  Industry guidance: ${getIndustryGuidance(body.industry)}`,
    `- Desired feeling(s) on first hearing: ${toneValue}`,
    `  Tone guidance: ${getCombinedToneGuidance(body.tone)}`,
    `- Naming archetype(s) requested: ${styleValue}`,
    `  Archetype guidance: ${getCombinedStyleGuidance(body.nameStyle)}`,
    body.referenceDomain ? `- Reference competitor domain: ${body.referenceDomain}` : "",
    referenceSeoSummary ? `- Reference SEO summary: ${referenceSeoSummary}` : "",
    referenceSeoKeywords?.length
      ? `- Reference SEO keywords: ${referenceSeoKeywords.slice(0, 15).join(", ")}`
      : "",
    "",
    "Produce a JSON creative brief with these fields:",
    "- positioning: ONE sentence in the shape 'for [who] who [pain/desire], we are [category] that [differentiator]'.",
    "- primaryAudience: the single most important customer described in concrete terms (not 'businesses' or 'users').",
    "- secondaryAudience (optional): a secondary cohort worth naming around.",
    "- personalityAdjectives: exactly 3 sharp adjectives that describe how the brand should feel. Avoid 'innovative', 'modern', 'cutting-edge'.",
    "- emotionalNorthStar: ONE feeling in 3-6 words that sums up what a great name should evoke.",
    "- antiPositioning: 2-5 short phrases describing what the brand is NOT, in the voice of a strategist. These guard against drift.",
    "- territoriesShortlist: exactly 5 short labels for distinct metaphor/name territories worth exploring (e.g. 'cartography', 'tides', 'old craft', 'phonetic invented', 'verb-first'). These are strategic lanes, not names.",
    "- avoidWordsInferred: words and fragments to avoid in names for this category (e.g. for fintech: 'coin', 'pay', 'bank'; for AI: 'ai', 'gpt', 'neuro').",
    "- cliches: category cliches competitors lean on and we should dodge (e.g. 'smart-', 'cloud-', '-ly', '-ify').",
  ]
    .filter(Boolean)
    .join("\n");

  const model = getJudgeModel();
  try {
    const completion = await getJudgeClient().chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: BRIEF_SCHEMA },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      logWarn("brief_enrichment.empty_response_content", { model });
      return null;
    }

    const parsed = JSON.parse(content) as unknown;
    const brief = normalizeBrief(parsed);
    if (!brief) {
      logWarn("brief_enrichment.invalid_response_shape", { model });
      return null;
    }

    cachePut(key, brief);
    return brief;
  } catch (error) {
    logError("brief_enrichment.failed", error, { model });
    return null;
  }
}

export function formatBriefForPrompt(brief: EnrichedBrief): string {
  const lines: string[] = [
    "Creative brief (the strategy the names must land):",
    `- Positioning: ${brief.positioning}`,
    `- Primary audience: ${brief.primaryAudience}`,
  ];
  if (brief.secondaryAudience) {
    lines.push(`- Secondary audience: ${brief.secondaryAudience}`);
  }
  if (brief.personalityAdjectives.length) {
    lines.push(`- Personality: ${brief.personalityAdjectives.join(", ")}`);
  }
  lines.push(`- Emotional north star: ${brief.emotionalNorthStar}`);
  if (brief.antiPositioning.length) {
    lines.push(`- We are NOT: ${brief.antiPositioning.join("; ")}`);
  }
  if (brief.avoidWordsInferred.length) {
    lines.push(
      `- Avoid these words/fragments for this category: ${brief.avoidWordsInferred.join(", ")}`,
    );
  }
  if (brief.cliches.length) {
    lines.push(`- Category cliches to dodge: ${brief.cliches.join(", ")}`);
  }
  return lines.join("\n");
}
