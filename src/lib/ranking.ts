import type { NameCandidate } from "@/types";

function hasBalancedVowels(base: string): boolean {
  const vowels = base.match(/[aeiou]/g)?.length ?? 0;
  const ratio = vowels / base.length;
  return ratio >= 0.25 && ratio <= 0.6;
}

function hasTripleRepeat(base: string): boolean {
  return /(.)\1\1/.test(base);
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

export function rankCandidates(candidates: NameCandidate[]): NameCandidate[] {
  const withScores = candidates.map((candidate) => {
    let score = candidate.domains.reduce(
      (acc, domain) => acc + scoreDomain(domain.domain, domain.available),
      0,
    );

    if (candidate.base.length >= 6 && candidate.base.length <= 8) {
      score += 10;
    }
    if (!hasTripleRepeat(candidate.base)) {
      score += 5;
    }
    if (hasBalancedVowels(candidate.base)) {
      score += 5;
    }

    return {
      ...candidate,
      score,
    };
  });

  return withScores.sort((a, b) => b.score - a.score);
}
