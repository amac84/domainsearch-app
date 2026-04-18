import type { NameCandidate } from "@/types";

function hasBalancedVowels(base: string): boolean {
  const vowels = base.match(/[aeiou]/g)?.length ?? 0;
  const ratio = vowels / base.length;
  return ratio >= 0.25 && ratio <= 0.6;
}

function hasTripleRepeat(base: string): boolean {
  return /(.)\1\1/.test(base);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scoreDomain(domain: string, available: boolean): number {
  if (!available) {
    return 0;
  }

  const isPrefixed = domain.startsWith("get") || domain.startsWith("try");
  if (!isPrefixed && domain.endsWith(".com")) {
    return 100;
  }
  if (!isPrefixed && domain.endsWith(".ai")) {
    return 95;
  }
  if (!isPrefixed && domain.endsWith(".io")) {
    return 80;
  }
  if (!isPrefixed && domain.endsWith(".co")) {
    return 60;
  }
  if (isPrefixed && domain.endsWith(".com")) {
    return 40;
  }
  return 20;
}

function scoreLength(base: string): number {
  const len = base.length;
  if (len >= 6 && len <= 8) return 95;
  if (len === 5 || len === 9) return 85;
  if (len === 4 || len === 10) return 72;
  if (len === 11 || len === 12) return 55;
  return 35;
}

function scorePronounceability(base: string): number {
  let score = 72;
  const vowelCount = base.match(/[aeiou]/g)?.length ?? 0;
  const hardClusterMatches = base.match(/[bcdfghjklmnpqrstvwxyz]{4,}/g) ?? [];
  if (hasBalancedVowels(base)) score += 15;
  if (!hasTripleRepeat(base)) score += 8;
  if (vowelCount === 0) score -= 42;
  if (vowelCount === 1 && base.length >= 6) score -= 14;
  if (hardClusterMatches.length > 0) {
    score -= 24;
    score -= (hardClusterMatches.length - 1) * 8;
  }
  if (/[^aeiou]{3}(?!e)/.test(base)) score -= 10;
  if (/(q(?!u))/.test(base)) score -= 12;
  if (/(zx|xq|qj|jq|vv|jj)/.test(base)) score -= 8;
  if (/[0-9]/.test(base)) score -= 12;
  return clamp(Math.round(score), 0, 100);
}

function scoreBrandability(base: string, pronounceability: number): number {
  let score = 55;
  score += Math.round(pronounceability * 0.25);
  if (!/[0-9]/.test(base)) score += 10;
  if (/^[a-z]+$/.test(base)) score += 8;
  if (new Set(base).size >= Math.min(base.length, 6)) score += 6;
  if (base.endsWith("ly") || base.endsWith("io") || base.endsWith("iq")) score += 4;
  if (base.length <= 4) score -= 10;
  return clamp(Math.round(score), 0, 100);
}

function scoreAiVibe(candidate: NameCandidate): number {
  const base = candidate.base;
  const aiSignals = [
    "ai",
    "neuro",
    "vector",
    "tensor",
    "byte",
    "data",
    "logic",
    "cloud",
    "node",
    "synth",
    "quant",
    "nova",
  ];
  let score = 45;
  if (aiSignals.some((signal) => base.includes(signal))) score += 30;
  if (candidate.domains.some((d) => d.available && d.domain === `${base}.ai`)) score += 20;
  if (base.endsWith("labs") || base.endsWith("ops") || base.endsWith("stack")) score += 10;
  return clamp(Math.round(score), 0, 100);
}

export interface RankCandidatesOptions {
  selectedTlds?: string[];
  nameStyle?: string;
}

/**
 * Lunour archetypes are the canonical style keys. Older keys are aliased to
 * the closest archetype so saved searches keep ranking sensibly.
 */
function normalizeStyle(nameStyle: string | undefined): string {
  const raw = (nameStyle ?? "evocative").toLowerCase().replace(/-/g, "");
  const aliases: Record<string, string> = {
    moderntech: "evocative",
    futuristicai: "invented",
    brandable: "invented",
    professional: "descriptive",
  };
  return aliases[raw] ?? raw;
}

function toWeightProfile(selectedTlds: string[], nameStyle: string | undefined): {
  domain: number;
  brandability: number;
  pronounceability: number;
  length: number;
  aiVibe: number;
} {
  const normalized = selectedTlds.map((tld) =>
    tld.toLowerCase().replace(/^\.+/, ""),
  );
  const hasAi = normalized.includes("ai");
  const hasCom = normalized.includes("com");
  const style = normalizeStyle(nameStyle);

  if (style === "descriptive") {
    return { domain: 0.34, brandability: 0.18, pronounceability: 0.28, length: 0.16, aiVibe: 0.04 };
  }
  if (style === "abstract") {
    return {
      domain: hasAi && !hasCom ? 0.28 : 0.31,
      brandability: 0.24,
      pronounceability: 0.16,
      length: 0.1,
      aiVibe: hasAi && !hasCom ? 0.22 : 0.19,
    };
  }
  if (style === "invented") {
    return {
      domain: hasAi && !hasCom ? 0.28 : 0.3,
      brandability: 0.32,
      pronounceability: 0.2,
      length: 0.12,
      aiVibe: hasAi && !hasCom ? 0.1 : 0.06,
    };
  }
  if (style === "experiential") {
    return { domain: 0.32, brandability: 0.28, pronounceability: 0.24, length: 0.12, aiVibe: 0.04 };
  }
  if (style === "portmanteau") {
    return { domain: 0.31, brandability: 0.26, pronounceability: 0.23, length: 0.16, aiVibe: 0.04 };
  }
  if (style === "metaphor" || style === "place") {
    return { domain: 0.33, brandability: 0.27, pronounceability: 0.22, length: 0.13, aiVibe: 0.05 };
  }
  // evocative (default for Lunour)
  if (hasAi && !hasCom) {
    return { domain: 0.29, brandability: 0.27, pronounceability: 0.21, length: 0.1, aiVibe: 0.13 };
  }
  return { domain: 0.34, brandability: 0.28, pronounceability: 0.22, length: 0.1, aiVibe: 0.06 };
}

function adjustLengthForStyle(
  baseLengthScore: number,
  base: string,
  nameStyle: string | undefined,
): number {
  const style = normalizeStyle(nameStyle);
  let score = baseLengthScore;
  if (style === "descriptive" || style === "portmanteau") {
    if (base.length >= 7 && base.length <= 12) score += 8;
    if (base.length <= 4) score -= 6;
  } else if (style === "abstract") {
    if (base.length >= 6 && base.length <= 10) score += 8;
    if (base.length <= 4) score -= 6;
  } else if (style === "invented") {
    if (base.length >= 4 && base.length <= 8) score += 8;
    if (base.length >= 10) score -= 6;
  } else if (style === "experiential") {
    if (base.length >= 4 && base.length <= 7) score += 10;
    if (base.length >= 9) score -= 8;
  } else if (style === "metaphor" || style === "place") {
    if (base.length >= 5 && base.length <= 9) score += 6;
    if (base.length >= 12) score -= 6;
  } else {
    // evocative
    if (base.length >= 5 && base.length <= 8) score += 6;
    if (base.length >= 11) score -= 8;
  }
  return clamp(score, 0, 100);
}

function adjustBrandabilityForStyle(
  baseBrandability: number,
  base: string,
  nameStyle: string | undefined,
): number {
  const style = normalizeStyle(nameStyle);
  let score = baseBrandability;
  if (style === "descriptive") {
    if (/(hub|kit|box|base|stack|works|ly|ify)$/.test(base)) score -= 4;
  } else if (style === "abstract") {
    if (/(nova|neuro|tensor|vector|synth|logic|lab|gen|flux)/.test(base)) score += 8;
  } else if (style === "invented") {
    if (base.length <= 7 && /^[a-z]+$/.test(base)) score += 6;
    if (/(x|z|k|v)/.test(base) && base.length <= 8) score += 4;
  } else if (style === "experiential") {
    if (base.length <= 6 && /^[a-z]+$/.test(base)) score += 6;
    if (/(a|e|o)$/.test(base)) score += 3;
  } else if (style === "portmanteau") {
    if (base.length >= 7 && base.length <= 11) score += 4;
  } else if (style === "metaphor" || style === "place") {
    if (/(a|e|o)$/.test(base) && base.length >= 5) score += 4;
  } else {
    // evocative
    if (base.length >= 5 && base.length <= 8) score += 4;
  }
  return clamp(score, 0, 100);
}

function adjustAiVibeForStyle(
  baseAiVibe: number,
  base: string,
  nameStyle: string | undefined,
): number {
  const style = normalizeStyle(nameStyle);
  let score = baseAiVibe;
  if (style === "abstract") {
    if (/(lab|mind|gen|model|agent|neuro|vector|tensor|synth|ops|stack|core|flux)/.test(base)) score += 10;
  } else if (style === "descriptive") {
    score -= 10;
  } else if (style === "invented") {
    score -= 4;
  }
  return clamp(score, 0, 100);
}

export function rankCandidates(
  candidates: NameCandidate[],
  options: RankCandidatesOptions = {},
): NameCandidate[] {
  const weights = toWeightProfile(options.selectedTlds ?? [], options.nameStyle);

  // Deduplicate by base, merging domain results so multi-pass combinations
  // never produce duplicate bases (which cause React key warnings in the UI).
  const merged = new Map<string, NameCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.base);
    if (!existing) {
      merged.set(candidate.base, candidate);
    } else {
      const domainMap = new Map(existing.domains.map((d) => [d.domain, d]));
      for (const d of candidate.domains) {
        if (!domainMap.has(d.domain)) domainMap.set(d.domain, d);
      }
      merged.set(candidate.base, { ...existing, domains: Array.from(domainMap.values()) });
    }
  }
  const deduplicated = Array.from(merged.values());

  const withScores = deduplicated.map((candidate) => {
    const domainScoreRaw = candidate.domains.reduce(
      (acc, domain) => acc + scoreDomain(domain.domain, domain.available),
      0,
    );
    const domainScore = candidate.domains.length
      ? clamp(Math.round(domainScoreRaw / candidate.domains.length), 0, 100)
      : 0;
    const pronounceability = scorePronounceability(candidate.base);
    const brandability = adjustBrandabilityForStyle(
      scoreBrandability(candidate.base, pronounceability),
      candidate.base,
      options.nameStyle,
    );
    const length = adjustLengthForStyle(
      scoreLength(candidate.base),
      candidate.base,
      options.nameStyle,
    );
    const aiVibe = adjustAiVibeForStyle(
      scoreAiVibe(candidate),
      candidate.base,
      options.nameStyle,
    );
    const score = Math.round(
      domainScore * weights.domain +
        brandability * weights.brandability +
        pronounceability * weights.pronounceability +
        length * weights.length +
        aiVibe * weights.aiVibe,
    );

    return {
      ...candidate,
      score,
      scoreBreakdown: {
        brandability,
        pronounceability,
        length,
        aiVibe,
      },
    };
  });

  return withScores.sort((a, b) => b.score - a.score);
}
