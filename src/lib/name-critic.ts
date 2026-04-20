import { formatBriefForPrompt } from "@/lib/brief-enrichment";
import {
  getCreativeClient,
  getCreativeModel,
  getJudgeClient,
  getJudgeModel,
} from "@/lib/llm-clients";
import { logError, logWarn } from "@/lib/server-logger";
import type { EnrichedBrief, SevenFilterScores } from "@/types";

/**
 * Phase 3 of the v2 pipeline: LLM-as-judge rubric scoring + targeted revision.
 *
 * Names are scored against Lunour's seven filters (evocative, memorable,
 * spellable, speakable, ownable, scalable, domain-viable) with a one-line
 * weakness note. Survivors above a quality bar move on; the weakest names are
 * sent back to the creative model for focused revision that fixes the named
 * weakness. Only the curated survivor set hits the domain-check API after
 * this stage.
 */

export interface CritiqueItem {
  base: string;
  scores: SevenFilterScores;
  weakness: string;
  composite: number;
}

export interface CritiqueResult {
  items: CritiqueItem[];
}

const FILTER_SCHEMA = {
  name: "name_critique",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            base: { type: "string" },
            evocative: { type: "number" },
            memorable: { type: "number" },
            spellable: { type: "number" },
            speakable: { type: "number" },
            ownable: { type: "number" },
            scalable: { type: "number" },
            domainViable: { type: "number" },
            weakness: { type: "string" },
          },
          required: [
            "base",
            "evocative",
            "memorable",
            "spellable",
            "speakable",
            "ownable",
            "scalable",
            "domainViable",
            "weakness",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
} as const;

const REVISION_SCHEMA = {
  name: "name_revisions",
  schema: {
    type: "object",
    properties: {
      revisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            originalBase: { type: "string" },
            revisedBase: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["originalBase", "revisedBase", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["revisions"],
    additionalProperties: false,
  },
} as const;

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function compositeOf(scores: SevenFilterScores): number {
  // Weighted slightly: ownable + evocative + memorable matter most for
  // separating the top 40% from the rest; spellable/speakable filter the bottom.
  return (
    scores.evocative * 1.3 +
    scores.memorable * 1.3 +
    scores.ownable * 1.3 +
    scores.spellable * 0.9 +
    scores.speakable * 0.9 +
    scores.scalable * 1.0 +
    scores.domainViable * 0.8
  );
}

export interface ScoreAgainstFiltersInput {
  names: string[];
  brief?: EnrichedBrief;
  description: string;
  industry?: string;
  batchSize?: number;
}

async function scoreBatch(
  batch: string[],
  briefBlock: string,
  input: ScoreAgainstFiltersInput,
): Promise<CritiqueItem[]> {
  const model = getJudgeModel();
  const completion = await getJudgeClient().chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "You are a senior naming strategist critiquing brand name candidates.",
          "Score each candidate on the seven Lunour filters (1-5 each, higher is better):",
          "- evocative: does it make you feel something?",
          "- memorable: could you repeat it 3 days later with no cue?",
          "- spellable: can someone spell it after hearing it once?",
          "- speakable: does it sound good out loud, clean stress pattern?",
          "- ownable: distinctive enough to trademark (not a generic category word)?",
          "- scalable: will it still fit as the company grows/pivots?",
          "- domainViable: short and coined enough that a reasonable domain is plausible?",
          "For each name, also return a SINGLE concise weakness sentence naming the single biggest flaw to fix.",
          "Be critical. Do not inflate scores. Use the full 1-5 range.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          briefBlock,
          `Industry: ${input.industry ?? "unspecified"}.`,
          `Raw description: ${input.description}`,
          "",
          "Candidates to score (one line each):",
          batch.map((name) => `- ${name}`).join("\n"),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    response_format: { type: "json_schema", json_schema: FILTER_SCHEMA },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    logWarn("name_critic.empty_response", { model, batchSize: batch.length });
    return [];
  }

  try {
    const parsed = JSON.parse(content) as {
      items?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.items)) return [];
    const validBases = new Set(batch.map((name) => name.toLowerCase()));
    const out: CritiqueItem[] = [];
    for (const raw of parsed.items) {
      if (!raw || typeof raw !== "object") continue;
      const base = typeof raw.base === "string" ? raw.base.trim() : "";
      if (!base || !validBases.has(base.toLowerCase())) continue;
      const scores: SevenFilterScores = {
        evocative: clampScore(raw.evocative),
        memorable: clampScore(raw.memorable),
        spellable: clampScore(raw.spellable),
        speakable: clampScore(raw.speakable),
        ownable: clampScore(raw.ownable),
        scalable: clampScore(raw.scalable),
        domainViable: clampScore(raw.domainViable),
      };
      const weakness =
        typeof raw.weakness === "string" ? raw.weakness.trim() : "";
      out.push({
        base,
        scores,
        weakness,
        composite: compositeOf(scores),
      });
    }
    return out;
  } catch (error) {
    logError("name_critic.parse_failed", error, {
      model,
      batchSize: batch.length,
    });
    return [];
  }
}

const DEFAULT_BATCH_SIZE = 30;

export async function scoreAgainstFilters(
  input: ScoreAgainstFiltersInput,
): Promise<CritiqueResult> {
  const names = Array.from(new Set(input.names.map((n) => n.trim()).filter(Boolean)));
  if (names.length === 0) return { items: [] };

  const batchSize = Math.max(5, Math.min(input.batchSize ?? DEFAULT_BATCH_SIZE, 60));
  const briefBlock = input.brief ? formatBriefForPrompt(input.brief) : "";

  const batches: string[][] = [];
  for (let i = 0; i < names.length; i += batchSize) {
    batches.push(names.slice(i, i + batchSize));
  }

  const results = await Promise.all(
    batches.map((batch) => scoreBatch(batch, briefBlock, input)),
  );

  return { items: results.flat() };
}

export interface ReviseInput {
  items: CritiqueItem[];
  brief?: EnrichedBrief;
  description: string;
  industry?: string;
  maxLength: number;
  /** How many revisions to produce per weak item (1-2). */
  variantsPerName?: number;
}

export interface RevisionResult {
  revisions: Array<{
    originalBase: string;
    revisedBase: string;
    rationale: string;
  }>;
}

export async function reviseWeakNames(
  input: ReviseInput,
): Promise<RevisionResult> {
  const items = input.items.filter((item) => item.base.trim().length > 0);
  if (items.length === 0) return { revisions: [] };

  const variants = Math.max(1, Math.min(input.variantsPerName ?? 1, 2));
  const briefBlock = input.brief ? formatBriefForPrompt(input.brief) : "";
  const model = getCreativeModel();

  const prompt = [
    "You are a brand naming strategist.",
    "For each weak name below, produce a revised name that fixes the named weakness while keeping the spirit and territory.",
    `Produce up to ${variants} revision(s) per original. Each revision must be a fresh, distinct name (not a trivial re-spelling).`,
    "Revised names should be lowercase, 4-" + Math.max(6, input.maxLength) + " characters where possible, no spaces, no hyphens, pronounceable on first hearing.",
    "",
    briefBlock,
    `Industry: ${input.industry ?? "unspecified"}`,
    `Raw description: ${input.description}`,
    "",
    "Weak names to revise (format: original | weakness):",
    items
      .map((item) => `- ${item.base} | ${item.weakness || "generic or low impact"}`)
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await getCreativeClient().chat.completions.create({
      model,
      temperature: 0.85,
      messages: [
        {
          role: "system",
          content:
            "You revise brand names. Keep the spirit, fix the weakness. Produce fresh names, not minor rewrites. Always match the requested output shape.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_schema", json_schema: REVISION_SCHEMA },
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      logWarn("name_critic.revise_empty_response", { model });
      return { revisions: [] };
    }
    const parsed = JSON.parse(content) as {
      revisions?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.revisions)) return { revisions: [] };

    const originals = new Set(items.map((item) => item.base.toLowerCase()));
    const revisions = parsed.revisions
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const original =
          typeof entry.originalBase === "string"
            ? entry.originalBase.trim().toLowerCase()
            : "";
        const revised =
          typeof entry.revisedBase === "string"
            ? entry.revisedBase.trim().toLowerCase()
            : "";
        const rationale =
          typeof entry.rationale === "string" ? entry.rationale.trim() : "";
        if (!original || !revised || !originals.has(original)) return null;
        if (revised === original) return null;
        return { originalBase: original, revisedBase: revised, rationale };
      })
      .filter((v): v is { originalBase: string; revisedBase: string; rationale: string } =>
        v !== null,
      );

    return { revisions };
  } catch (error) {
    logError("name_critic.revise_failed", error, { model });
    return { revisions: [] };
  }
}

export interface CurateBatchInput {
  names: string[];
  brief?: EnrichedBrief;
  description: string;
  industry?: string;
  maxLength: number;
  /** Keep top fraction by composite score. Default 0.4. */
  survivorFraction?: number;
  /** Maximum number of names to revise. Default 30. */
  maxToRevise?: number;
  /** Minimum absolute number of survivors to keep (if possible). Default 20. */
  minSurvivors?: number;
}

export interface CurateBatchResult {
  survivors: Array<{
    base: string;
    scores: SevenFilterScores;
    weakness: string;
    composite: number;
  }>;
  revisedNames: Array<{ base: string; revisedFrom: string; rationale: string }>;
  scoredCount: number;
}

/**
 * End-to-end curation step: score a batch of raw names, keep the best portion,
 * and produce fresh revisions of the weakest survivors. The caller then feeds
 * `survivors + revisedNames` to the domain-check stage.
 */
export async function curateBatch(
  input: CurateBatchInput,
): Promise<CurateBatchResult> {
  const { items } = await scoreAgainstFilters({
    names: input.names,
    brief: input.brief,
    description: input.description,
    industry: input.industry,
  });
  if (items.length === 0) {
    return { survivors: [], revisedNames: [], scoredCount: 0 };
  }

  const survivorFraction = Math.max(0.1, Math.min(input.survivorFraction ?? 0.4, 0.8));
  const sorted = [...items].sort((a, b) => b.composite - a.composite);
  const targetByFraction = Math.ceil(sorted.length * survivorFraction);
  const minSurvivors = Math.max(1, input.minSurvivors ?? 20);
  const survivorCount = Math.min(
    sorted.length,
    Math.max(targetByFraction, minSurvivors),
  );
  const survivors = sorted.slice(0, survivorCount);

  // Revise the weakest of the survivors (not the bottom-60%, which we already dropped).
  // This keeps names that are almost-good and pushes them over the bar.
  const maxToRevise = Math.max(5, Math.min(input.maxToRevise ?? 30, survivors.length));
  const weakestInSurvivors = [...survivors]
    .sort((a, b) => a.composite - b.composite)
    .slice(0, maxToRevise);

  const { revisions } = await reviseWeakNames({
    items: weakestInSurvivors,
    brief: input.brief,
    description: input.description,
    industry: input.industry,
    maxLength: input.maxLength,
  });

  const survivorBases = new Set(survivors.map((s) => s.base.toLowerCase()));
  const revisedNames = revisions
    .filter((rev) => rev.revisedBase && !survivorBases.has(rev.revisedBase))
    .map((rev) => ({
      base: rev.revisedBase,
      revisedFrom: rev.originalBase,
      rationale: rev.rationale,
    }));

  return { survivors, revisedNames, scoredCount: items.length };
}
