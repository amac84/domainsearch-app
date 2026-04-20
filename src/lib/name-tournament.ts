import { formatBriefForPrompt } from "@/lib/brief-enrichment";
import { getJudgeClient, getJudgeModel } from "@/lib/llm-clients";
import { logError, logWarn } from "@/lib/server-logger";
import type { EnrichedBrief, NameCandidate } from "@/types";

/**
 * Phase 6 of the v2 pipeline: pairwise Swiss-style tournament over the top
 * names to produce a sharper ordering than rubric ranking alone. Judges are
 * better at A-vs-B than absolute scoring, so this is our last-mile quality
 * signal. Cost is bounded by `topN * rounds`.
 */

const PAIR_SCHEMA = {
  name: "pair_judgement",
  schema: {
    type: "object",
    properties: {
      winner: { type: "string", enum: ["A", "B", "tie"] },
      reason: { type: "string" },
    },
    required: ["winner", "reason"],
    additionalProperties: false,
  },
} as const;

export interface TournamentInput {
  candidates: NameCandidate[];
  brief?: EnrichedBrief;
  description: string;
  industry?: string;
  topN?: number;
  rounds?: number;
  /** Max pair comparisons to run in parallel in a single batch. */
  concurrency?: number;
}

export interface TournamentResult {
  /** Winners ordered best-first (length <= topN). */
  rankedBases: string[];
  /** Map of base -> reason collected from the last round that featured it. */
  reasons: Record<string, string>;
}

async function pairwiseJudge(
  a: { base: string; critique?: string },
  b: { base: string; critique?: string },
  context: {
    briefBlock: string;
    description: string;
    industry?: string;
  },
): Promise<{ winner: "A" | "B" | "tie"; reason: string }> {
  const model = getJudgeModel();
  try {
    const completion = await getJudgeClient().chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "You are comparing two brand name candidates for a single brief.",
            "Pick the name that better fits the brief on the Lunour seven filters:",
            "evocative, memorable, spellable, speakable, ownable, scalable, domain-viable.",
            "Be decisive. Only tie when genuinely indistinguishable.",
            "Return one of: A, B, or tie. Give a SINGLE concise reason.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            context.briefBlock,
            `Industry: ${context.industry ?? "unspecified"}.`,
            `Raw description: ${context.description}`,
            "",
            `A: ${a.base}${a.critique ? ` (earlier note: ${a.critique})` : ""}`,
            `B: ${b.base}${b.critique ? ` (earlier note: ${b.critique})` : ""}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      response_format: { type: "json_schema", json_schema: PAIR_SCHEMA },
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return { winner: "tie", reason: "" };
    const parsed = JSON.parse(content) as { winner?: unknown; reason?: unknown };
    const winner =
      parsed.winner === "A" || parsed.winner === "B" || parsed.winner === "tie"
        ? parsed.winner
        : "tie";
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    return { winner, reason };
  } catch (error) {
    logError("name_tournament.pair_failed", error, { model });
    return { winner: "tie", reason: "" };
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

async function runBatches<T, R>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const outcome = await Promise.all(batch.map(worker));
    results.push(...outcome);
  }
  return results;
}

export async function runTournament(
  input: TournamentInput,
): Promise<TournamentResult> {
  const topN = Math.max(4, Math.min(input.topN ?? 30, 60));
  const rounds = Math.max(1, Math.min(input.rounds ?? 3, 5));
  const concurrency = Math.max(2, Math.min(input.concurrency ?? 10, 20));

  const seeded = input.candidates.slice(0, topN);
  if (seeded.length < 2) {
    return {
      rankedBases: seeded.map((c) => c.base),
      reasons: {},
    };
  }

  const briefBlock = input.brief ? formatBriefForPrompt(input.brief) : "";
  const context = {
    briefBlock,
    description: input.description,
    industry: input.industry,
  };

  // Initialize scores from heuristic + critique composite so seeding is
  // sensible. First round pairs rely on this.
  const score = new Map<string, number>();
  const critiqueByBase = new Map<string, string>();
  for (const candidate of seeded) {
    const base = candidate.base;
    const weight =
      (candidate.score ?? 0) +
      (candidate.filterScores
        ? candidate.filterScores.evocative +
          candidate.filterScores.memorable +
          candidate.filterScores.ownable
        : 0);
    score.set(base, weight);
    if (candidate.critiqueNotes) {
      critiqueByBase.set(base, candidate.critiqueNotes);
    }
  }

  const reasons: Record<string, string> = {};
  const playedPairs = new Set<string>();

  for (let round = 0; round < rounds; round += 1) {
    const ordered = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([base]) => base);

    const pairsThisRound: Array<{ a: string; b: string }> = [];
    const matched = new Set<string>();
    for (let i = 0; i < ordered.length; i += 1) {
      const a = ordered[i];
      if (matched.has(a)) continue;
      for (let j = i + 1; j < ordered.length; j += 1) {
        const b = ordered[j];
        if (matched.has(b)) continue;
        const key = pairKey(a, b);
        if (playedPairs.has(key)) continue;
        pairsThisRound.push({ a, b });
        playedPairs.add(key);
        matched.add(a);
        matched.add(b);
        break;
      }
    }

    if (pairsThisRound.length === 0) break;

    const outcomes = await runBatches(pairsThisRound, concurrency, async (pair) => {
      const { winner, reason } = await pairwiseJudge(
        { base: pair.a, critique: critiqueByBase.get(pair.a) },
        { base: pair.b, critique: critiqueByBase.get(pair.b) },
        context,
      );
      return { pair, winner, reason };
    });

    for (const { pair, winner, reason } of outcomes) {
      if (winner === "A") {
        score.set(pair.a, (score.get(pair.a) ?? 0) + 1);
        reasons[pair.a] = reason || reasons[pair.a] || "";
      } else if (winner === "B") {
        score.set(pair.b, (score.get(pair.b) ?? 0) + 1);
        reasons[pair.b] = reason || reasons[pair.b] || "";
      } else {
        // tie: split the point so neither rises
        score.set(pair.a, (score.get(pair.a) ?? 0) + 0.5);
        score.set(pair.b, (score.get(pair.b) ?? 0) + 0.5);
      }
    }
  }

  const rankedBases = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([base]) => base);

  return { rankedBases, reasons };
}

export interface ApplyTournamentInput {
  candidates: NameCandidate[];
  brief?: EnrichedBrief;
  description: string;
  industry?: string;
  /** Number of top positions to rewrite with tournament order. */
  rewriteTopN?: number;
  topN?: number;
  rounds?: number;
}

export interface ApplyTournamentOutput {
  candidates: NameCandidate[];
  reasons: Record<string, string>;
}

/**
 * Run a tournament over the top N candidates and rewrite the *first* M
 * positions of the output array with tournament order. Positions beyond M
 * keep the incoming order. This bounds cost while still sharpening the
 * most-visible portion of the list.
 */
export async function applyTournament(
  input: ApplyTournamentInput,
): Promise<ApplyTournamentOutput> {
  const rewriteTopN = Math.max(4, Math.min(input.rewriteTopN ?? 10, 20));
  const topN = Math.max(rewriteTopN, Math.min(input.topN ?? 30, 60));
  const { rankedBases, reasons } = await runTournament({
    candidates: input.candidates,
    brief: input.brief,
    description: input.description,
    industry: input.industry,
    topN,
    rounds: input.rounds,
  });

  if (rankedBases.length === 0) {
    logWarn("name_tournament.empty_result", {
      candidateCount: input.candidates.length,
    });
    return { candidates: input.candidates, reasons: {} };
  }

  const byBase = new Map(input.candidates.map((c) => [c.base, c]));
  const newTop: NameCandidate[] = [];
  const usedBases = new Set<string>();
  for (const base of rankedBases) {
    if (newTop.length >= rewriteTopN) break;
    const candidate = byBase.get(base);
    if (!candidate) continue;
    newTop.push(candidate);
    usedBases.add(base);
  }

  const remainder = input.candidates.filter((c) => !usedBases.has(c.base));
  return {
    candidates: [...newTop, ...remainder],
    reasons,
  };
}
