import { formatBriefForPrompt } from "@/lib/brief-enrichment";
import { getCreativeClient, getCreativeModel } from "@/lib/llm-clients";
import { getCombinedStyleGuidance, getCombinedToneGuidance } from "@/lib/name-generation";
import { logError, logWarn } from "@/lib/server-logger";
import type { EnrichedBrief, GenerateRequestBody, Territory } from "@/types";

/**
 * Phase 4 of the v2 pipeline: plan five distinct creative territories that
 * the per-territory generators will work inside. Seeded from the enriched
 * brief's `territoriesShortlist` (Phase 1) so the strategy and execution
 * share the same north star.
 */

const TERRITORY_SCHEMA = {
  name: "name_territories",
  schema: {
    type: "object",
    properties: {
      territories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            premise: { type: "string" },
            archetype: { type: "string" },
            tone: { type: "string" },
            exemplars: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
            },
            soundShapes: {
              type: "array",
              items: { type: "string" },
              maxItems: 6,
            },
          },
          required: ["name", "premise", "archetype", "tone", "exemplars", "soundShapes"],
          additionalProperties: false,
        },
        maxItems: 5,
      },
    },
    required: ["territories"],
    additionalProperties: false,
  },
} as const;

export interface PlanTerritoriesInput {
  body: Pick<
    GenerateRequestBody,
    "description" | "industry" | "tone" | "nameStyle"
  >;
  brief: EnrichedBrief;
  referenceSeoSummary?: string;
  desiredCount?: number;
}

function sanitizeArray(value: unknown, cap: number): string[] {
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

function normalizeTerritory(raw: unknown): Territory | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const premise = typeof data.premise === "string" ? data.premise.trim() : "";
  const archetype = typeof data.archetype === "string" ? data.archetype.trim() : "";
  const tone = typeof data.tone === "string" ? data.tone.trim() : "";
  if (!name || !premise) return null;
  return {
    name,
    premise,
    archetype,
    tone,
    exemplars: sanitizeArray(data.exemplars, 8),
    soundShapes: sanitizeArray(data.soundShapes, 6),
  };
}

export async function planTerritories(
  input: PlanTerritoriesInput,
): Promise<Territory[]> {
  const desired = Math.max(3, Math.min(input.desiredCount ?? 5, 6));
  const { body, brief } = input;

  const toneLabel = Array.isArray(body.tone)
    ? body.tone.join(", ")
    : body.tone || "trust";
  const styleLabel = Array.isArray(body.nameStyle)
    ? body.nameStyle.join(", ")
    : body.nameStyle || "evocative";

  const system = [
    "You are the creative director at a top naming agency.",
    "Your job is to define distinct creative territories (metaphor lanes) for a single naming project.",
    "A territory is NOT a name. It is a strategic angle with a clear premise, archetype, tone, and reference exemplars.",
    "Each territory must be meaningfully different from the others so the final batch has real variety.",
    "Favor territories that can produce ownable, short, verb-friendly names in the spirit of: stripe, notion, loom, figma, linear, vercel, patagonia, aesop, ribbon, atlas.",
  ].join(" ");

  const user = [
    formatBriefForPrompt(brief),
    "",
    "Shortlist of territories to consider (from strategy, use or replace as needed):",
    brief.territoriesShortlist.length
      ? brief.territoriesShortlist.map((t) => `- ${t}`).join("\n")
      : "- (none suggested, invent 5 fresh lanes)",
    "",
    `Desired feeling: ${toneLabel}. ${getCombinedToneGuidance(body.tone)}`,
    `Requested archetype(s): ${styleLabel}. ${getCombinedStyleGuidance(body.nameStyle)}`,
    body.industry ? `Industry: ${body.industry}` : "",
    input.referenceSeoSummary
      ? `Reference SEO context (do not copy competitor names): ${input.referenceSeoSummary}`
      : "",
    "",
    `Produce exactly ${desired} creative territories. For each:`,
    "- name: a short punchy label (e.g. 'Cartography', 'Tides', 'Old Craft', 'Phonetic Invented', 'Verb-First').",
    "- premise: 1-2 sentences describing the angle and why it fits this brand's strategy.",
    "- archetype: ONE of evocative, invented, metaphor, experiential, portmanteau, abstract, place, descriptive.",
    "- tone: ONE of trust, delight, power, safety, curiosity, calm, warmth, precision, mystery.",
    "- exemplars: 3-5 real-world brand names that embody this territory (the team borrows their SPIRIT, not their letters).",
    "- soundShapes: 2-4 phonetic hints (e.g. 'CV-CV', 'soft start + hard end', 'front vowels', 'short + two syllables').",
    "Territories must be DISTINCT. Do not let two territories share the same archetype AND tone.",
  ]
    .filter(Boolean)
    .join("\n");

  const model = getCreativeModel();
  try {
    const completion = await getCreativeClient().chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: TERRITORY_SCHEMA },
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      logWarn("territory_planner.empty_response", { model });
      return [];
    }
    const parsed = JSON.parse(content) as { territories?: unknown };
    if (!Array.isArray(parsed.territories)) return [];
    const territories: Territory[] = [];
    for (const raw of parsed.territories) {
      const normalized = normalizeTerritory(raw);
      if (normalized) territories.push(normalized);
    }
    return territories.slice(0, desired);
  } catch (error) {
    logError("territory_planner.failed", error, { model });
    return [];
  }
}
