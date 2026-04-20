import OpenAI from "openai";

/**
 * Two-model split:
 * - "creative" model is used for the expensive, quality-critical work
 *   (territory planning, name generation, revision). Defaults to whatever
 *   OPENAI_MODEL was set to so existing installs behave the same.
 * - "judge" model is used for cheap, bounded judging/critique work
 *   (brief enrichment, scoring, quality ranking, pairwise tournament).
 *
 * Clients are memoized per role so we don't open a new connection every call.
 */

export type LlmRole = "creative" | "judge";

const DEFAULT_FALLBACK_MODEL = "gpt-4o-mini";

let creativeClient: OpenAI | null = null;
let judgeClient: OpenAI | null = null;

function assertApiKey(): void {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add OPENAI_API_KEY=sk-... to .env in the domainsearch-app folder (no quotes, no spaces around =), then restart the dev server.",
    );
  }
}

export function getCreativeModel(): string {
  return (
    process.env.OPENAI_CREATIVE_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_FALLBACK_MODEL
  );
}

export function getJudgeModel(): string {
  return (
    process.env.OPENAI_JUDGE_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_FALLBACK_MODEL
  );
}

export function getCreativeClient(): OpenAI {
  assertApiKey();
  if (!creativeClient) {
    creativeClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return creativeClient;
}

export function getJudgeClient(): OpenAI {
  assertApiKey();
  if (!judgeClient) {
    judgeClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return judgeClient;
}

export function getClientForRole(role: LlmRole): OpenAI {
  return role === "creative" ? getCreativeClient() : getJudgeClient();
}

export function getModelForRole(role: LlmRole): string {
  return role === "creative" ? getCreativeModel() : getJudgeModel();
}

export type PipelineVersion = "v1" | "v2";

export function getPipelineVersion(): PipelineVersion {
  const raw = process.env.NAME_PIPELINE_VERSION?.trim().toLowerCase();
  return raw === "v2" ? "v2" : "v1";
}

function flag(envName: string, defaultValue: boolean): boolean {
  const raw = process.env[envName]?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return defaultValue;
}

/** Per-phase feature flags. Default on when v2 is selected. */
export function isCritiqueEnabled(): boolean {
  return flag("NAME_PIPELINE_CRITIQUE", getPipelineVersion() === "v2");
}

export function areTerritoriesEnabled(): boolean {
  return flag("NAME_PIPELINE_TERRITORIES", getPipelineVersion() === "v2");
}

export function isTournamentEnabled(): boolean {
  return flag("NAME_PIPELINE_TOURNAMENT", getPipelineVersion() === "v2");
}
