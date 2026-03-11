import type { SavedName } from "@/types";

const STORAGE_KEY = "domainsearch-saved";

function read(): SavedName[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: SavedName[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota or other errors
  }
}

export function getSavedNames(): SavedName[] {
  return read();
}

export function addSavedName(item: Omit<SavedName, "id" | "savedAt">): SavedName {
  const full: SavedName = {
    ...item,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  };
  const items = read();
  items.unshift(full);
  write(items);
  return full;
}

export function addSavedNames(newItems: Omit<SavedName, "id" | "savedAt">[]): void {
  const items = read();
  const withMeta: SavedName[] = newItems.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  }));
  write([...withMeta, ...items]);
}

export function removeSavedName(id: string): void {
  const items = read().filter((i) => i.id !== id);
  write(items);
}

export function setSavedNames(items: SavedName[]): void {
  write(items);
}
