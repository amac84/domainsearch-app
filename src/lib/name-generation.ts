import type { NameGenerationInput } from "@/types";
import { formatBriefForPrompt } from "@/lib/brief-enrichment";
import { getCreativeClient, getCreativeModel } from "@/lib/llm-clients";
import { logError, logWarn } from "@/lib/server-logger";

/** System prompt aligned with `lunour-naming.skill` (Lunour naming framework) at repo root. */
function buildSystemPrompt(): string {
  return [
    "You are an expert brand naming strategist — part creative director, part linguist, part startup advisor. You name companies and products that are memorable, evocative, ownable, and built to last.",
    "",
    "Naming is strategy, not a word game. A name sets the psychological spirit of a company. It is the first thing investors hear and the first thing customers say to friends. Name the feeling first, the function second.",
    "Founder mindset: you are naming what this could become, not only what the product does on day one.",
    "",
    "Draw names from across these archetypes (do not cluster on one):",
    "- Evocative / Emotional: names that evoke a feeling, not the literal product (e.g. stripe, drift, notion, loom, slack, figma)",
    "- Invented / Coined: portmanteaus, morpheme play, engineered sound (e.g. kodak, spotify, verizon, xerox)",
    "- Metaphor / Analogy: borrowed from a different domain to create resonance (e.g. amazon, apple, ribbon, firefly)",
    "- Experiential / Verb-friendly: names that become verbs in natural language (e.g. zoom, uber, google)",
    "- Portmanteau / Mashup: two meaningful words fused cleanly (e.g. pinterest, instagram)",
    "- Abstract / Designed sound: pure phonetic craft with no inherent meaning (e.g. accenture, agilent)",
    "- Place / atmosphere: inherit scale, journey, or landscape as abstract brand fuel — not literal city or country labels.",
    "- Short modern coinage in the startup register (e.g. brex, plaid, gusto, ramp, clerk, vercel, linear, canva)",
    "",
    "Before emitting a name, silently run it through these seven filters; keep only names that pass most:",
    "1. Evocative — does it make you feel something?",
    "2. Memorable — could someone repeat it 3 days later with no cue?",
    "3. Spellable — can someone spell it after hearing it once?",
    "4. Speakable — does it sound good out loud with a clean stress pattern?",
    "5. Ownable — is it distinctive enough to trademark (not a generic category word)?",
    "6. Scalable — will it still fit as the company grows or pivots beyond today's product?",
    "7. Domain-viable — is it short and coined enough that a reasonable domain is plausible?",
    "",
    "Quick checks: When someone hears this for the first time, what do they feel — and is that what the brand needs? Say it once; would it still come to mind days later without a cue?",
    "",
    "Do:",
    "- Be evocative over descriptive.",
    "- Favor short names — ideally 1–2 syllables, max 3. Short names spread faster.",
    "- Invent or transform words: portmanteaus, altered spellings, unexpected metaphors.",
    "- Engineer sound: clean stress pattern, one clear mouthfeel, no consonant pileups.",
    "- Think about language network effects — names that can become verbs or nouns win.",
    "- Diversify the batch: vary archetype, endings, vowel/consonant shape, and length.",
    "- Global readiness: avoid obvious negative or profane homophones in common Romance-language and English listening; prefer phonetically approachable shapes over harsh unexplained clusters when the brand could be international.",
    "",
    "Don't:",
    "- Don't be generic. 'TechSolutions', 'SmartPlatform', 'CloudHub' are dead on arrival.",
    "- Don't use hard-to-spell variants like 'Xtr3me', 'Kloud', 'Phlo' — friction kills spread.",
    "- Don't mangle good names to chase availability. A bad name with a good domain is still a bad name.",
    "- Don't rely on meaningless acronyms — they have no built-in meaning to carry.",
    "- Don't copy category conventions (e.g. piling on '-ly', '-ify', '-io', '-ai' suffixes).",
    "- Don't cluster sibling-sounding names in the same batch.",
    "",
    "Follow requested output constraints exactly (word count, syllables, invented-vs-dictionary, max length).",
    "Return plain lowercase strings only.",
  ].join("\n");
}

/**
 * Lunour-style "feeling" guidance for each tone. Tone is the answer to the
 * Phase 1 discovery question: when someone hears the name, what should they feel?
 * Older keys (bold, technical, playful, etc.) are kept as fallback aliases so
 * previously saved searches continue to render gracefully.
 */
export function getToneGuidance(tone: string | undefined): string {
  const key = (tone || "trust").toLowerCase();
  const guidance: Record<string, string> = {
    trust:
      "Should feel safe, credible, and established. Reach for clear, grounded sounds and steady stress patterns; avoid whimsy, slang, or anything that reads as a stunt.",
    delight:
      "Should feel joyful, light, and playful — a small smile on first hearing. Bright vowel shapes and friendly consonants are welcome; never silly.",
    power:
      "Should feel confident, decisive, and large in scale. Strong consonants and clear impact; the name commands the room without shouting.",
    safety:
      "Should feel calm, protective, and dependable. Soft, even sounds; no edges, no friction. Think: a name a parent or finance lead would trust.",
    curiosity:
      "Should feel intriguing, layered, and a touch unexpected. A small mystery you want to repeat aloud; uncommon sound shapes that still pass the spell-on-first-hearing test.",
    calm:
      "Should feel peaceful, low-pressure, and quiet. Open vowels, soft endings; nothing aggressive or cluttered.",
    warmth:
      "Should feel human, friendly, and approachable. Personal, conversational; reads like something said by a friend, not a corporation.",
    precision:
      "Should feel exact, engineered, and well-built. Clean phonetics, no ornamentation; suggests logic, systems, and craft without sounding cold.",
    mystery:
      "Should feel evocative and a little unknown — leaves room for narrative. Atmospheric word-shapes; the name hints rather than explains.",
    other:
      "Should feel versatile and credible — neutral enough to work across contexts while still evocative.",
  };
  if (guidance[key]) return guidance[key];
  // Backwards-compatible aliases for the previous tone vocabulary.
  const aliases: Record<string, string> = {
    bold: guidance.power,
    technical: guidance.precision,
    playful: guidance.delight,
    premium: guidance.trust,
    professional: guidance.trust,
    modern: guidance.precision,
    minimal: guidance.calm,
    balanced: guidance.other,
  };
  return aliases[key] ?? guidance.trust;
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

/**
 * Lunour naming-archetype guidance. These match the categories in
 * `references/naming-types.md` of `lunour-naming.skill`. Older style keys
 * (modern-tech, futuristic-ai, brandable, professional) are kept as
 * backwards-compatible aliases for any previously saved searches.
 */
export function getStyleGuidance(style: string | undefined): string {
  const key = (style || "evocative").toLowerCase().replace(/-/g, "");
  const guidance: Record<string, string> = {
    evocative:
      "Evocative / emotional names that conjure a feeling, atmosphere, or texture rather than the literal product. Draw from nature, music, movement, or sensory texture (e.g. stripe, drift, notion, loom, slack, figma).",
    invented:
      "Invented / coined words: portmanteaus, morpheme play, engineered sound. Entirely ownable, globally workable, with strong trademark potential (e.g. kodak, xerox, spotify, verizon).",
    metaphor:
      "Metaphor / analogy names borrowed from a different domain that creates resonance with the brand. Layered, narrative-rich, often nature- or animal-led (e.g. amazon, apple, ribbon, firefly).",
    experiential:
      "Experiential / verb-friendly names that naturally become a verb or behavior in everyday speech. Designed for high-frequency, network-effect use (e.g. zoom, uber, google, slack).",
    portmanteau:
      "Portmanteau / mashup of two meaningful words fused so the seam feels natural and a single stress pattern emerges (e.g. pinterest, instagram, microsoft).",
    abstract:
      "Abstract / designed-sound names with no inherent meaning — pure phonetic craft. Meaning is built later through brand investment (e.g. accenture, agilent, häagen-dazs).",
    place:
      "Place / atmosphere names that borrow the feeling of a real or imagined location — scale, journey, or landscape — without being literal geography (e.g. amazon, patagonia, atlassian).",
    descriptive:
      "Descriptive / functional names that say what the product does. Easy to grasp and SEO-friendly, but harder to trademark — pair with a strong brand layer (e.g. basecamp, dropbox, salesforce).",
  };
  if (guidance[key]) return guidance[key];
  const aliases: Record<string, string> = {
    moderntech: guidance.evocative,
    futuristicai: guidance.invented,
    brandable: guidance.invented,
    professional: guidance.descriptive,
  };
  return aliases[key] ?? guidance.evocative;
}

function normalizeToArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

/** Combine guidance for multiple feelings (e.g. trust + warmth). */
export function getCombinedToneGuidance(tone: string | string[] | undefined): string {
  const keys = normalizeToArray(tone);
  if (keys.length === 0) return getToneGuidance("trust");
  if (keys.length === 1) return getToneGuidance(keys[0]);
  const parts = keys.map((t) => getToneGuidance(t));
  return `Blend these feelings on first hearing: ${parts.join(" Also: ")}`;
}

/** Combine guidance for multiple Lunour archetypes. */
export function getCombinedStyleGuidance(nameStyle: string | string[] | undefined): string {
  const keys = normalizeToArray(nameStyle);
  if (keys.length === 0) return getStyleGuidance("evocative");
  if (keys.length === 1) return getStyleGuidance(keys[0]);
  const parts = keys.map((s) => getStyleGuidance(s));
  return `Blend these naming archetypes: ${parts.join(" Also: ")}`;
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
        "Introduce variety: include names with different sounds and structures, not only close variants of the available names.",
      ].join("\n")
    : "";
  // Hard de-dup list. Cap at 200 to keep prompt tokens bounded; the pipeline
  // also post-filters duplicates so this is purely a token-saving hint.
  const avoidBasesList = (input.avoidBases ?? [])
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 200);
  const avoidBasesInstruction = avoidBasesList.length
    ? [
        "Already attempted (do NOT emit any of these exact names; pick fresh strings):",
        avoidBasesList.join(", "),
      ].join("\n")
    : "";
  const wordConstraint = input.wordConstraint ?? "oneWord";
  const syllableConstraint = input.syllableConstraint ?? "any";
  const wordTypeConstraint = input.wordTypeConstraint ?? "invented";
  const maxSyllables =
    syllableConstraint === "two" ? 2 : input.maxSyllables;
  const wordShapeInstructions =
    wordConstraint === "twoWord"
      ? [
          "- Exactly 2 words",
          "- Use a single space between the two words",
          "- No hyphens",
          "- Lowercase only",
        ]
      : [
          "- Exactly 1 word",
          "- No spaces",
          "- No hyphens",
          "- Lowercase only",
        ];
  const syllableInstruction =
    syllableConstraint === "two"
      ? "- Exactly 2 syllables total"
      : `- At most ${input.maxSyllables} syllables`;
  const inventedInstruction =
    wordTypeConstraint === "invented"
      ? "- Use invented or coined names (not common dictionary words)"
      : wordTypeConstraint === "dictionary"
        ? "- Use real recognizable English dictionary words only (no coined or made-up words)"
        : "- Mixed words allowed (invented and dictionary-inspired are both acceptable)";

  const territory = input.territory;
  const brief = input.brief;
  const exemplars = input.exemplars?.filter(Boolean).slice(0, 10) ?? [];
  const morphemes = input.morphemes?.filter((m) => m?.morpheme && m?.meaning).slice(0, 12) ?? [];
  const avoidWordsFromBrief = brief?.avoidWordsInferred?.slice(0, 20) ?? [];
  const clichesFromBrief = brief?.cliches?.slice(0, 20) ?? [];

  const briefBlock = brief
    ? formatBriefForPrompt(brief)
    : "Discovery (internalize before you generate; output is names only): infer what the company does, who the primary customer is, the core feeling they want, and 2-3 personality adjectives from the brief. If the brief is thin, choose versatile, credible names and still diversify archetypes.";

  const territoryBlock = territory
    ? [
        "",
        "Creative territory (every name you produce MUST sit inside this one lane):",
        `- Territory name: ${territory.name}`,
        `- Premise: ${territory.premise}`,
        `- Archetype: ${territory.archetype}`,
        `- Tone: ${territory.tone}`,
        territory.soundShapes.length
          ? `- Sound shapes to favor: ${territory.soundShapes.join(", ")}`
          : "",
        territory.exemplars.length
          ? `- Reference exemplars (do not copy; draw on their spirit): ${territory.exemplars.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const exemplarsBlock = exemplars.length
    ? [
        "",
        "Style exemplars (real brands that hit this archetype+tone; borrow the feeling, do not copy):",
        exemplars.join(", "),
      ].join("\n")
    : "";

  const morphemesBlock = morphemes.length
    ? [
        "",
        "Morpheme seed material (roots you may combine, transform, invert, or ignore):",
        morphemes.map((m) => `${m.morpheme} (${m.meaning})`).join("; "),
      ].join("\n")
    : "";

  // When we are inside a specific territory, do NOT ask the model to diversify
  // across archetypes - diversity now comes from running multiple territories
  // in parallel. Otherwise keep the original spread instruction.
  const diversityInstruction = territory
    ? "- Stay strictly inside the territory above; variety comes from exploring different angles WITHIN the territory."
    : "- Spread the batch across distinct naming archetypes (evocative, invented/coined, metaphor, place/atmosphere, portmanteau, experiential, designed-sound). Do not let one archetype dominate.";

  return [
    "Brand context (names should align with this):",
    briefBlock,
    input.description.trim()
      ? `Raw description: ${input.description}`
      : "General startup or product - versatile, credible names.",
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
    "Feeling and archetype (follow this closely; weights the batch but does not lock to one category):",
    (() => {
      const tones = normalizeToArray(input.tone);
      const styles = normalizeToArray(input.nameStyle);
      const toneLabelValue = tones.length > 0 ? tones.join(", ") : "trust";
      const styleLabelValue = styles.length > 0 ? styles.join(", ") : "evocative";
      return [
        `Feeling(s) on first hearing: ${toneLabelValue}. ${getCombinedToneGuidance(input.tone)}`,
        `Lunour archetype(s) to weight: ${styleLabelValue}. ${getCombinedStyleGuidance(input.nameStyle)}`,
      ].join("\n");
    })(),
    territoryBlock,
    exemplarsBlock,
    morphemesBlock,
    "",
    "Constraints:",
    `- Max length: ${input.maxLength}`,
    `- Max syllables: ${maxSyllables}`,
    `- Avoid dictionary words: ${input.avoidDictionaryWords ? "yes" : "no"}`,
    `- Word constraint: ${wordConstraint}`,
    `- Syllable constraint: ${syllableConstraint}`,
    `- Word type constraint: ${wordTypeConstraint}`,
    `- Avoid these words: ${avoidWords}`,
    avoidWords !== "none"
      ? "- Do not use words that sound very similar to or could be confused with the avoided words above."
      : "",
    avoidWordsFromBrief.length
      ? `- Category words/fragments to avoid (from strategic brief): ${avoidWordsFromBrief.join(", ")}.`
      : "",
    clichesFromBrief.length
      ? `- Category cliches to dodge (from strategic brief): ${clichesFromBrief.join(", ")}.`
      : "",
    `Generate ${input.count} brand names:`,
    "- 5-10 characters where possible",
    syllableInstruction,
    inventedInstruction,
    "- Pronounceable with a single clear stress pattern",
    diversityInstruction,
    "- Vary endings, vowel/consonant shape, and length. Avoid clustering sibling-sounding names (e.g. many ending in -io, -ly, -ify, -ai, -ex).",
    "- Each name must pass the core test: evocative, memorable, spellable on first hearing, and ownable (not a generic category word).",
    "- Prefer names that could plausibly become a verb or noun in everyday use.",
    "- Do not emit generic descriptor mashups (e.g. 'smart-', 'tech-', 'cloud-', '-hub', '-platform', '-solutions').",
    ...wordShapeInstructions,
    input.referenceSeoSummary
      ? "- Keep naming style and search-intent alignment similar to the reference summary, but do not copy the competitor's brand name."
      : "",
    input.temperature >= 0.75
      ? "- Include some names with unusual consonant blends or novel suffixes for extra variety."
      : "",
    refinementInstructions,
    avoidBasesInstruction,
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

  const model = getCreativeModel();
  const completion = await getCreativeClient().chat.completions.create({
    model,
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
      model,
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
        model,
        requestedCount: safeCount,
      });
      return [];
    }

    return names.filter((value): value is string => typeof value === "string");
  } catch (error) {
    logError("name_generation.parse_failed", error, {
      model,
      requestedCount: safeCount,
    });
    return [];
  }
}
