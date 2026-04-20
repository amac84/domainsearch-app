import exemplarsJson from "@/data/exemplars.json";
import morphemeBankJson from "@/data/morpheme-bank.json";
import type { EnrichedBrief } from "@/types";

/**
 * Phase 5 of the v2 pipeline: exemplar + morpheme seed material injected into
 * per-territory generation prompts. Exemplars demonstrate the desired style by
 * example (real, acclaimed brand names in the target archetype/tone cell).
 * Morphemes provide coinage raw material for invented names.
 */

type ExemplarsMap = Record<string, string[]>;
const EXEMPLARS: ExemplarsMap = exemplarsJson as ExemplarsMap;

interface MorphemeEntry {
  morpheme: string;
  meaning: string;
  origin?: string;
  feelings?: string[];
}

const MORPHEMES: MorphemeEntry[] = Array.isArray(
  (morphemeBankJson as { morphemes?: unknown }).morphemes,
)
  ? ((morphemeBankJson as { morphemes: MorphemeEntry[] }).morphemes)
  : [];

function normalizeKey(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function firstOf(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function randomPick<T>(values: T[], n: number): T[] {
  if (values.length <= n) return [...values];
  const pool = [...values];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export function pickExemplars(
  archetype: string | string[] | undefined,
  tone: string | string[] | undefined,
  count = 6,
): string[] {
  const archetypeKey = normalizeKey(firstOf(archetype)) || "evocative";
  const toneKey = normalizeKey(firstOf(tone)) || "trust";

  const primaryKey = `${archetypeKey}.${toneKey}`;
  const direct = EXEMPLARS[primaryKey];
  if (direct?.length) return randomPick(direct, count);

  // Fall back to any entry under the archetype with a tolerant tone match.
  const archetypeEntries = Object.entries(EXEMPLARS).filter(([key]) =>
    key.startsWith(`${archetypeKey}.`),
  );
  if (archetypeEntries.length > 0) {
    const pooled = archetypeEntries.flatMap(([, values]) => values);
    return randomPick(pooled, count);
  }

  // Fall back to any entry under the tone with a tolerant archetype match.
  const toneEntries = Object.entries(EXEMPLARS).filter(([key]) =>
    key.endsWith(`.${toneKey}`),
  );
  if (toneEntries.length > 0) {
    const pooled = toneEntries.flatMap(([, values]) => values);
    return randomPick(pooled, count);
  }

  // Last-resort: pool every entry.
  const all = Object.values(EXEMPLARS).flat();
  return randomPick(all, count);
}

export interface PickMorphemesOptions {
  brief?: EnrichedBrief;
  tone?: string | string[];
  count?: number;
}

export function pickMorphemes(
  options: PickMorphemesOptions = {},
): Array<{ morpheme: string; meaning: string }> {
  const count = Math.max(0, Math.min(options.count ?? 8, 15));
  if (count === 0 || MORPHEMES.length === 0) return [];

  const avoidSet = new Set(
    (options.brief?.avoidWordsInferred ?? [])
      .map((value) => normalizeKey(value))
      .filter(Boolean),
  );

  const toneTokens = Array.isArray(options.tone)
    ? options.tone.map(normalizeKey).filter(Boolean)
    : options.tone
      ? [normalizeKey(options.tone)]
      : [];

  // First prefer morphemes whose feelings overlap the tone.
  const preferred: MorphemeEntry[] = [];
  const rest: MorphemeEntry[] = [];
  for (const entry of MORPHEMES) {
    const normalized = normalizeKey(entry.morpheme);
    // Skip anything the brief explicitly flagged as a category cliche.
    if (avoidSet.has(normalized)) continue;

    const feelings = (entry.feelings ?? []).map(normalizeKey);
    const hit = toneTokens.length === 0
      ? false
      : toneTokens.some((token) => feelings.includes(token));
    if (hit) {
      preferred.push(entry);
    } else {
      rest.push(entry);
    }
  }

  const preferredPicks = randomPick(preferred, count);
  if (preferredPicks.length >= count) {
    return preferredPicks.map((entry) => ({
      morpheme: entry.morpheme,
      meaning: entry.meaning,
    }));
  }
  const filler = randomPick(rest, count - preferredPicks.length);
  return [...preferredPicks, ...filler].map((entry) => ({
    morpheme: entry.morpheme,
    meaning: entry.meaning,
  }));
}
