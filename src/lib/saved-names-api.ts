import type { SavedName } from "@/types";

interface SaveNameInput {
  base: string;
  domains: SavedName["domains"];
  rationale?: string;
  score: number;
  scoreBreakdown?: SavedName["scoreBreakdown"];
  summaryConclusion?: string;
  recommendationReason?: string;
}

interface SavedNamesResponse {
  items?: SavedName[];
  error?: string;
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

async function parseOrThrow(response: Response): Promise<SavedNamesResponse> {
  const payload = (await response.json()) as SavedNamesResponse;
  if (response.status === 401) {
    throw new AuthRequiredError(payload.error ?? "Authentication required.");
  }
  if (!response.ok) {
    throw new Error(payload.error ?? "Saved names request failed.");
  }
  return payload;
}

export async function fetchSavedNames(): Promise<SavedName[]> {
  const response = await fetch("/api/saved-names", {
    cache: "no-store",
  });
  const payload = await parseOrThrow(response);
  return payload.items ?? [];
}

export async function createSavedName(item: SaveNameInput): Promise<SavedName> {
  const response = await fetch("/api/saved-names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [item] }),
  });
  const payload = await parseOrThrow(response);
  return payload.items?.[0] as SavedName;
}

export async function createSavedNames(items: SaveNameInput[]): Promise<SavedName[]> {
  if (items.length === 0) return [];
  const response = await fetch("/api/saved-names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const payload = await parseOrThrow(response);
  return payload.items ?? [];
}

export async function deleteSavedName(id: string): Promise<void> {
  const response = await fetch(`/api/saved-names?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseOrThrow(response);
}
