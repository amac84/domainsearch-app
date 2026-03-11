import OpenAI from "openai";

import type { NameGenerationInput } from "@/types";
import { logError, logWarn } from "@/lib/server-logger";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add OPENAI_API_KEY=sk-... to .env in the domainsearch-app folder (no quotes, no spaces around =), then restart the dev server.",
    );
  }

  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return client;
}

function buildSystemPrompt(): string {
  return [
    "You are an expert brand strategist and startup naming consultant.",
    "",
    "Generate short, natural-sounding brand names that feel like real company names.",
    "",
    "Good examples of the style: stripe, brex, ramp, clerk, gusto, plaid, notion, vercel.",
    "",
    "Guidelines:",
    "- Names should be easy to pronounce and remember.",
    "- Prefer simple phonetic structures.",
    "- Names should sound like they could already exist as a word or brand, even if invented.",
    "- Favor modern, credible startup-style names.",
    "",
    "Only return lowercase strings with no spaces and no hyphens.",
  ].join("\n");
}

/** Returns concrete naming guidance for the selected tone so the model knows how to shape names. */
export function getToneGuidance(tone: string | undefined): string {
  const key = (tone || "balanced").toLowerCase();
  const guidance: Record<string, string> = {
    professional:
      "Names must sound established, trustworthy, and corporate-appropriate. Prefer clear, serious, credible sounds suitable for B2B, consulting, or enterprise. Avoid playful, cute, or whimsical overtones. Think: McKinsey, Deloitte, Accenture—authoritative and no-nonsense.",
    bold:
      "Names should feel confident, memorable, and assertive. Strong consonants and clear impact; names that stand out and command attention.",
    technical:
      "Names should evoke precision, engineering, or software. Slightly more abstract or coined; can suggest logic, systems, or innovation. Avoid soft or fluffy sounds.",
    playful:
      "Names can be lighter, friendlier, or more inventive. Slight whimsy or approachability is fine; still pronounceable and brand-like, not silly.",
    premium:
      "Names should feel high-end, refined, or exclusive. Elegant word-shapes; avoid cheap or generic sounds. Think luxury, quality, aspiration.",
    modern:
      "Names should feel current, clean, and forward-looking. Contemporary startup aesthetic; crisp and uncluttered, not dated or stuffy.",
    minimal:
      "Names should be short, simple, and unadorned. Few syllables, clear sounds; nothing fussy or overwrought.",
    balanced:
      "Names should feel versatile and credible—neither too corporate nor too casual. Suitable for a wide range of contexts.",
    other:
      "Names should feel versatile and credible—suitable for a wide range of contexts.",
  };
  return guidance[key] ?? guidance.balanced;
}

/** Returns industry-specific naming guidance (used in generation and quality ranking). */
export function getIndustryGuidance(industry: string | undefined): string {
  if (!industry?.trim()) return "Names should work across industries—versatile and credible.";
  const key = industry.toLowerCase().trim();
  const guidance: Record<string, string> = {
    fintech:
      "Names should convey trust, security, or innovation. Avoid overly casual or playful sounds; think clarity and credibility for money and data.",
    finance:
      "Names should feel trustworthy and established. Prefer clear, serious sounds; avoid whimsy or ambiguity.",
    healthcare:
      "Names should feel trustworthy, precise, or caring as appropriate. Avoid flippant or purely playful overtones; consider compliance and patient trust.",
    health: "Same as healthcare: trustworthy, precise, or caring; avoid flippant overtones.",
    saas:
      "Names can be modern, crisp, and product-led. Tech-forward but still pronounceable and memorable.",
    software: "Similar to SaaS: modern, crisp, product-led; tech-forward and memorable.",
    enterprise:
      "Names should sound scalable, reliable, and B2B-appropriate. Avoid consumer-cute or niche slang.",
    b2b:
      "Names should feel credible and business-appropriate; clear and professional rather than playful.",
    consumer:
      "Names can be friendlier and more memorable for broad audiences; still brand-like and pronounceable.",
    ecommerce:
      "Names should be memorable and often approachable; consider trust and discoverability.",
    edtech:
      "Names should feel credible and supportive of learning; avoid gimmicky or childish sounds.",
    education: "Same as edtech: credible, supportive of learning; avoid gimmicky sounds.",
    legal:
      "Names should sound authoritative, precise, and trustworthy; avoid casual or playful overtones.",
    consulting:
      "Names should convey expertise and gravitas; think established and no-nonsense.",
    agency:
      "Names can be creative but still professional; memorable and distinct without being silly.",
    nonprofit:
      "Names should feel mission-driven and trustworthy; avoid corporate or purely commercial overtones.",
    ai:
      "Names can suggest intelligence, automation, or future-forward; still human and pronounceable.",
  };
  for (const [k, v] of Object.entries(guidance)) {
    if (key.includes(k)) return v;
  }
  return "Names should fit the industry: credible, memorable, and appropriate for the sector.";
}

function buildUserPrompt(input: NameGenerationInput): string {
  const premiumTargets = input.prioritizePremiumTlds?.length
    ? input.prioritizePremiumTlds.map((tld) => `.${tld}`).join(" or ")
    : null;

  const avoidWords = input.avoidWords.length
    ? input.avoidWords.join(", ")
    : "none";
  const seoKeywords = input.referenceSeoKeywords?.length
    ? input.referenceSeoKeywords.slice(0, 12).join(", ")
    : "";

  const availableList =
    input.refineFrom
      ?.filter((item) => item.domains.some((domain) => domain.available))
      .map((item) => item.base)
      .slice(0, 40) ?? [];
  const unavailableList =
    input.refineFrom
      ?.filter((item) => item.domains.every((domain) => !domain.available))
      .map((item) => item.base)
      .slice(0, 40) ?? [];
  const refinementInstructions = input.refineFrom
    ? [
        "Refinement mode:",
        `Use naming direction similar to these more-available names: ${availableList.join(", ") || "none"}.`,
        `Avoid patterns from these unavailable names: ${unavailableList.join(", ") || "none"}.`,
      ].join("\n")
    : "";

  return [
    "Brand context (names should align with this):",
    input.description.trim()
      ? input.description
      : "General startup or product—versatile, credible names.",
    input.referenceDomain
      ? `Reference domain (style inspiration only; do not copy): ${input.referenceDomain}`
      : "",
    input.referenceSeoSummary
      ? `Reference SEO summary (align naming style and search intent with this; do not copy the competitor's name): ${input.referenceSeoSummary}`
      : "",
    seoKeywords
      ? `Reference SEO keywords: ${seoKeywords}`
      : "",
    "",
    "Industry and naming fit:",
    `Industry: ${input.industry || "unspecified"}. ${getIndustryGuidance(input.industry)}`,
    "",
    "Tone and style (follow this closely):",
    `Tone: ${input.tone || "balanced"}. ${getToneGuidance(input.tone)}`,
    "",
    "Constraints:",
    `- Max length: ${input.maxLength}`,
    `- Max syllables: ${input.maxSyllables}`,
    `- Avoid dictionary words: ${input.avoidDictionaryWords ? "yes" : "no"}`,
    `- Avoid these words: ${avoidWords}`,
    avoidWords !== "none"
      ? "- Do not use words that sound very similar to or could be confused with the avoided words above."
      : "",
    `Generate ${input.count} invented brand names:`,
    "- 5-10 characters where possible",
    `- At most ${input.maxSyllables} syllables`,
    "- Pronounceable",
    "- No spaces",
    "- No hyphens",
    "- Lowercase only",
    "- Avoid common English words",
    input.referenceSeoSummary
      ? "- Keep naming style and search-intent alignment similar to the reference summary, but do not copy the competitor's brand name."
      : "",
    input.temperature >= 0.95
      ? "- Use unusual consonant blends and novel suffixes."
      : "",
    refinementInstructions,
    premiumTargets && input.refineFrom
      ? `Goal: We need names where the exact ${premiumTargets} domain is available. Prioritize the same style as the names that already have those domains available.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export async function generateNames(input: NameGenerationInput): Promise<string[]> {
  const safeCount = clamp(input.count, 1, 200);
  const safeTemperature = clamp(input.temperature, 0.3, 1.2);

  const completion = await getClient().chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: safeTemperature,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt({ ...input, count: safeCount }) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "brand_names",
        schema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              maxItems: safeCount,
            },
          },
          required: ["names"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    logWarn("name_generation.empty_response_content", {
      model: DEFAULT_MODEL,
      requestedCount: safeCount,
      temperature: safeTemperature,
    });
    return [];
  }

  try {
    const parsed = JSON.parse(content) as { names?: unknown };
    const names = parsed?.names;
    if (!Array.isArray(names)) {
      logWarn("name_generation.invalid_response_shape", {
        model: DEFAULT_MODEL,
        requestedCount: safeCount,
      });
      return [];
    }

    return names.filter((value): value is string => typeof value === "string");
  } catch (error) {
    logError("name_generation.parse_failed", error, {
      model: DEFAULT_MODEL,
      requestedCount: safeCount,
    });
    return [];
  }
}
