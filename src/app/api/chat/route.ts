import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createRequestContext, logError, logInfo, logWarn, publicErrorMessage } from "@/lib/server-logger";
import type { NameCandidate } from "@/types";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

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

function buildNamesDataset(names: NameCandidate[]): string {
  const dataset = names.map((candidate) => ({
    base: candidate.base,
    score: candidate.score,
    rationale: candidate.rationale ?? null,
    domains: candidate.domains.map((domain) => ({
      domain: domain.domain,
      available: domain.available,
      status: domain.status,
      premium: Boolean(domain.premium),
      price: domain.price ?? null,
    })),
  }));

  return JSON.stringify(dataset);
}

/**
 * Subset of the client-side FormState we accept as context. All optional —
 * the model uses these to anchor its `suggestion` to the user's current run.
 */
export interface ChatFormContext {
  description?: string;
  referenceDomain?: string;
  industry?: string;
  tone?: string[];
  nameStyle?: string[];
  wordConstraint?: "oneWord" | "twoWord";
  syllableConstraint?: "any" | "two";
  wordTypeConstraint?: "mixed" | "invented" | "dictionary";
  maxLength?: number;
  maxSyllables?: number;
  avoidDictionaryWords?: boolean;
  avoidWords?: string;
  tlds?: string[];
  temperature?: number;
  count?: number;
  includePrefixVariants?: boolean;
  minPremiumTarget?: number;
  requireAllTlds?: boolean;
}

export interface ChatSuggestion {
  /** Short, button-friendly label, e.g. "Generate more names that sound like 'Lume'". */
  label: string;
  /** Replacement / refined description for the prompt textarea. Null to keep current. */
  description?: string | null;
  tone?: string[] | null;
  nameStyle?: string[] | null;
  wordConstraint?: "oneWord" | "twoWord" | null;
  syllableConstraint?: "any" | "two" | null;
  wordTypeConstraint?: "mixed" | "invented" | "dictionary" | null;
  maxLength?: number | null;
  maxSyllables?: number | null;
  avoidDictionaryWords?: boolean | null;
  avoidWords?: string[] | null;
  tlds?: string[] | null;
  temperature?: number | null;
  count?: number | null;
  includePrefixVariants?: boolean | null;
  minPremiumTarget?: number | null;
  requireAllTlds?: boolean | null;
}

export interface ChatRequestBody {
  names: NameCandidate[];
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  currentForm?: ChatFormContext;
}

const VALID_TONES = new Set([
  "trust", "delight", "power", "safety", "curiosity",
  "calm", "warmth", "precision", "mystery",
]);
const VALID_NAME_STYLES = new Set([
  "evocative", "invented", "metaphor", "experiential",
  "portmanteau", "abstract", "place", "descriptive",
]);
const VALID_WORD_CONSTRAINT = new Set(["oneWord", "twoWord"]);
const VALID_SYLLABLE_CONSTRAINT = new Set(["any", "two"]);
const VALID_WORD_TYPE = new Set(["mixed", "invented", "dictionary"]);

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return out.length > 0 ? out : null;
}

function asEnumValue<T extends string>(value: unknown, allowed: Set<string>): T | null {
  if (typeof value !== "string") return null;
  return allowed.has(value) ? (value as T) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asInt(value: unknown): number | null {
  const n = asNumber(value);
  return n == null ? null : Math.round(n);
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function sanitizeSuggestion(raw: unknown): ChatSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label.trim() : "";
  if (!label) return null;

  const tones = asStringArray(r.tone)?.filter((t) => VALID_TONES.has(t)) ?? null;
  const styles = asStringArray(r.nameStyle)?.filter((s) => VALID_NAME_STYLES.has(s)) ?? null;
  const tlds = asStringArray(r.tlds)?.map((t) => t.toLowerCase().replace(/^\./, "")) ?? null;

  return {
    label,
    description: typeof r.description === "string" && r.description.trim()
      ? r.description.trim()
      : null,
    tone: tones && tones.length > 0 ? tones : null,
    nameStyle: styles && styles.length > 0 ? styles : null,
    wordConstraint: asEnumValue<"oneWord" | "twoWord">(r.wordConstraint, VALID_WORD_CONSTRAINT),
    syllableConstraint: asEnumValue<"any" | "two">(r.syllableConstraint, VALID_SYLLABLE_CONSTRAINT),
    wordTypeConstraint: asEnumValue<"mixed" | "invented" | "dictionary">(
      r.wordTypeConstraint,
      VALID_WORD_TYPE,
    ),
    maxLength: asInt(r.maxLength),
    maxSyllables: asInt(r.maxSyllables),
    avoidDictionaryWords: asBool(r.avoidDictionaryWords),
    avoidWords: asStringArray(r.avoidWords),
    tlds: tlds && tlds.length > 0 ? tlds : null,
    temperature: asNumber(r.temperature),
    count: asInt(r.count),
    includePrefixVariants: asBool(r.includePrefixVariants),
    minPremiumTarget: asInt(r.minPremiumTarget),
    requireAllTlds: asBool(r.requireAllTlds),
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const requestContext = createRequestContext(request, "/api/chat");
  try {
    const body = (await request.json()) as ChatRequestBody;
    logInfo("api.chat.request_start", {
      ...requestContext,
      nameCount: body.names?.length ?? 0,
      hasHistory: Boolean(body.history?.length),
      hasFormContext: Boolean(body.currentForm),
    });
    if (!body.names?.length) {
      logWarn("api.chat.validation_failed", {
        ...requestContext,
        reason: "missing_names",
      });
      return NextResponse.json(
        { error: "names array is required and must not be empty" },
        { status: 400 },
      );
    }
    if (!body.message?.trim()) {
      logWarn("api.chat.validation_failed", {
        ...requestContext,
        reason: "missing_message",
      });
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 },
      );
    }

    const datasetJson = buildNamesDataset(body.names);
    const formContextJson = JSON.stringify(body.currentForm ?? {});

    const systemContent = `You are the assistant inside a brand-name generation tool. You answer questions about a specific run of generated brand names and their domain availability, and you proactively suggest follow-up runs when the user is hinting at a direction.

You MUST return a single JSON object that strictly matches this shape:
{
  "reply": string,                              // The natural language answer to show to the user. Plain text. Concise.
  "suggestion": null | {
    "label": string,                            // Short button label (max ~80 chars), starting with a verb.
    "description": string | null,               // Refined "What are you building?" prompt to pre-fill, in one paragraph. Null to keep current.
    "tone": string[] | null,                    // Subset of: ["trust","delight","power","safety","curiosity","calm","warmth","precision","mystery"]
    "nameStyle": string[] | null,               // Subset of: ["evocative","invented","metaphor","experiential","portmanteau","abstract","place","descriptive"]
    "wordConstraint": "oneWord"|"twoWord"|null,
    "syllableConstraint": "any"|"two"|null,
    "wordTypeConstraint": "mixed"|"invented"|"dictionary"|null,
    "maxLength": integer | null,                // 4..20
    "maxSyllables": integer | null,             // 1..6
    "avoidDictionaryWords": boolean | null,
    "avoidWords": string[] | null,              // lowercased word list to avoid
    "tlds": string[] | null,                    // any of ["com","ai","io","co"]
    "temperature": number | null,               // 0.3..1.2
    "count": integer | null,                    // 50..200
    "includePrefixVariants": boolean | null,
    "minPremiumTarget": integer | null,         // 0..50
    "requireAllTlds": boolean | null
  }
}
No prose outside this JSON. No markdown. No code fences.

Use ONLY the dataset below as the source of truth for current names, scores, and availability. Never invent names, prices, or availability that are not present in the dataset.

DATASET (all generated names for this run):
${datasetJson}

CURRENT FORM CONTEXT (what produced this run):
${formContextJson}

Behavior rules for "reply":
1) Always answer the user's question directly first, in 1-4 short sentences, using the dataset.
2) When the user asks for filtering, grouping, counting, ranking, or comparisons, compute the answer from the full dataset.
3) Keep names in monospace style by writing them plainly (e.g. lume, vello.ai). Don't wrap in markdown.
4) If a leading or preference-seeking question is detected (examples: "which sounds like X", "which is closest to Y", "which is best", "most on-brand", "which feel premium", "what would you pick"), end the reply with ONE short prompt offering to act, e.g. "Want me to generate more in this direction?".

Behavior rules for "suggestion":
- Set "suggestion" to null for purely factual questions (counts, lists, simple lookups).
- Set "suggestion" to a populated object whenever the user's question implies a direction the tool can act on, especially:
  * "more like X" / "sounds like X" / "in the style of X"
  * "shorter / punchier / more invented / more dictionary-like"
  * "make them feel more [tone]"
  * "drop names that include [word]"
  * "focus only on [tld]" / "must have .com"
- The "label" must be a clear call to action, e.g.:
  * "Generate more names that sound like 'Lume'"
  * "Refine for shorter, more invented names"
  * "Generate names that must have .com available"
- The "description" should be a self-contained refined prompt for "What are you building?". Include the original product context from CURRENT FORM CONTEXT plus the new direction. Keep it under ~80 words.
- Only set fields you actually want to change. Use null for fields the user did not influence.
- For "avoidWords": include any words the user told you to drop, plus stems of names they said they disliked when relevant. Lowercase only.
- For "tone" / "nameStyle": only override when the user clearly steered toward a feeling or archetype. Otherwise null.
- "count" should usually be null. Only set it (50-200) if the user explicitly asked for more or fewer.

NEGATIVE PROVISIONS (very important):
The user often phrases things as exclusions. Treat any of the following as a negative provision and carry it through into the suggestion:
- "avoid X", "no X", "don't want X", "without X", "exclude X", "drop X", "remove X", "less of X", "I don't like X", "stop using X"
- Negation of a feeling/archetype: "doesn't feel premium", "too playful", "not that serious"
- Negation of a TLD: "not .io", "skip .io"
- Names the user explicitly dislikes from the dataset (e.g. "I don't want anything like vello"): treat the disliked stems as avoid words.

How to translate negatives into suggestion fields:
1) Words / stems / morphemes the user wants gone -> "avoidWords" (lowercased, no punctuation, deduped). Always cumulative — assume the existing avoidWords in CURRENT FORM CONTEXT also still apply; only add to them.
2) "No dictionary words" / "stop using real English" -> wordTypeConstraint="invented", avoidDictionaryWords=true.
3) "Only dictionary words" -> wordTypeConstraint="dictionary".
4) "Shorter" / "no more than N letters" -> maxLength (clamp 4..20).
5) "Fewer syllables" / "no more than N syllables" -> maxSyllables (clamp 1..6); "exactly two syllables" -> syllableConstraint="two".
6) "One word only" / "no two-word names" -> wordConstraint="oneWord". "Two-word only" -> "twoWord".
7) Negated tones: e.g. "less playful" -> remove "delight" from the tone array and prefer the opposite the user implies (e.g. "trust", "calm", "precision"). Always return the FULL desired tone array, not just the addition.
8) Negated archetypes: e.g. "not descriptive" -> drop "descriptive" from nameStyle and choose alternates from ["evocative","invented","metaphor","experiential","portmanteau","abstract","place"]. Always return the FULL desired nameStyle array.
9) TLDs: if the user says "no .io", return tlds = current tlds minus "io". If they say "must have .com", return tlds with "com" included and consider setting requireAllTlds=true when they said "must have all of them".
10) "More premium feel" / "must have .com or .ai" -> minPremiumTarget (default 5+); "exclude premium-only names" is informational only — do not change the field.

The "reply" must explicitly acknowledge the negative provision in plain language, e.g.: "Got it — I'll avoid 'cloud' and 'data' and skip dictionary words." This is critical for trust; the user needs to see what was understood.

If the user's message is ONLY a negative provision (e.g. "stop suggesting names with 'cloud'") with no other question, the "reply" should be a short confirmation and the "suggestion" should be populated so the next run honors it.

Output the JSON only.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      ...(body.history ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: body.message.trim() },
    ];

    const completion = await getClient().chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const rawContent = completion.choices[0]?.message?.content?.trim() ?? "";
    let reply = "I couldn’t generate a reply.";
    let suggestion: ChatSuggestion | null = null;

    if (rawContent) {
      try {
        const parsed = JSON.parse(rawContent) as {
          reply?: unknown;
          suggestion?: unknown;
        };
        if (typeof parsed.reply === "string" && parsed.reply.trim()) {
          reply = parsed.reply.trim();
        }
        suggestion = sanitizeSuggestion(parsed.suggestion);
      } catch (parseError) {
        logWarn("api.chat.parse_failed", {
          ...requestContext,
          rawPreview: rawContent.slice(0, 200),
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
        });
        reply = rawContent;
      }
    }

    logInfo("api.chat.success", {
      ...requestContext,
      durationMs: Date.now() - startedAt,
      replyChars: reply.length,
      hasSuggestion: Boolean(suggestion),
    });
    return NextResponse.json({ reply, suggestion });
  } catch (error) {
    logError("api.chat.request_failed", error, {
      ...requestContext,
      durationMs: Date.now() - startedAt,
    });
    const message = publicErrorMessage(error, "Chat request failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
