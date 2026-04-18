import type { SearchHistoryEntry } from "@/types";

interface HistoryResponse {
  items?: SearchHistoryEntry[];
  item?: SearchHistoryEntry;
  error?: string;
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

async function parseOrThrow(response: Response): Promise<HistoryResponse> {
  const payload = (await response.json()) as HistoryResponse;
  if (response.status === 401) {
    throw new AuthRequiredError(payload.error ?? "Authentication required.");
  }
  if (!response.ok) {
    throw new Error(payload.error ?? "Search history request failed.");
  }
  return payload;
}

type CreateHistoryInput = Omit<SearchHistoryEntry, "id" | "createdAt">;

export async function fetchSearchHistory(): Promise<SearchHistoryEntry[]> {
  const response = await fetch("/api/search-history", {
    cache: "no-store",
  });
  const payload = await parseOrThrow(response);
  return payload.items ?? [];
}

export async function createSearchHistoryEntry(
  item: CreateHistoryInput,
): Promise<SearchHistoryEntry> {
  const response = await fetch("/api/search-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
  });
  const payload = await parseOrThrow(response);
  return payload.item as SearchHistoryEntry;
}

export async function deleteSearchHistoryEntry(id: string): Promise<void> {
  const response = await fetch(`/api/search-history?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseOrThrow(response);
}

export async function clearSearchHistoryEntries(): Promise<void> {
  const response = await fetch("/api/search-history?all=1", {
    method: "DELETE",
  });
  await parseOrThrow(response);
}
