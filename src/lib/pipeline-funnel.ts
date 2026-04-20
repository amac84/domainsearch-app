import type { CandidateFunnel } from "@/types";

/**
 * Mutable accumulator threaded through the v2 pipeline to record how many
 * candidates survived each stage. Logged at the end of a run and attached
 * to `meta.funnel` so we can prove each stage earns its keep.
 */
export interface FunnelAccumulator {
  readonly snapshot: () => CandidateFunnel;
  readonly recordGenerated: (count: number) => void;
  readonly recordPreFilterSurvivors: (count: number) => void;
  readonly recordCritiqueSurvivors: (count: number) => void;
  readonly recordRevised: (count: number) => void;
  readonly recordDomainChecked: (count: number) => void;
  readonly recordFinal: (count: number) => void;
  readonly markStart: () => void;
  readonly markEnd: () => void;
}

export function createFunnel(pipelineVersion: "v1" | "v2"): FunnelAccumulator {
  const state: CandidateFunnel = {
    generated: 0,
    preFilterSurvivors: 0,
    critiqueSurvivors: 0,
    revised: 0,
    domainChecked: 0,
    final: 0,
    pipelineVersion,
  };

  let startedAt: number | null = null;

  return {
    snapshot: () => ({ ...state }),
    recordGenerated: (count) => {
      state.generated += count;
    },
    recordPreFilterSurvivors: (count) => {
      state.preFilterSurvivors += count;
    },
    recordCritiqueSurvivors: (count) => {
      state.critiqueSurvivors += count;
    },
    recordRevised: (count) => {
      state.revised += count;
    },
    recordDomainChecked: (count) => {
      state.domainChecked += count;
    },
    recordFinal: (count) => {
      state.final = count;
    },
    markStart: () => {
      startedAt = Date.now();
    },
    markEnd: () => {
      if (startedAt != null) {
        state.durationMs = Date.now() - startedAt;
      }
    },
  };
}
