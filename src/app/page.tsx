"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { addSavedName, addSavedNames, getSavedNames, removeSavedName } from "@/lib/saved-storage";
import type { GenerateResponseBody, NameCandidate, NameRecommendation, RefinementInputName, SavedName } from "@/types";

interface FormState {
  description: string;
  referenceDomain: string;
  industry: string;
  tone: string;
  maxLength: number;
  maxSyllables: number;
  avoidDictionaryWords: boolean;
  avoidWords: string;
  tlds: string[];
  temperature: number;
  count: number;
  includePrefixVariants: boolean;
  minPremiumTarget: number;
  requireAllTlds: boolean;
}

const DEFAULT_FORM: FormState = {
  description: "",
  referenceDomain: "",
  industry: "",
  tone: "bold",
  maxLength: 10,
  maxSyllables: 3,
  avoidDictionaryWords: true,
  avoidWords: "",
  tlds: ["com", "ai"],
  temperature: 0.7,
  count: 100,
  includePrefixVariants: false,
  minPremiumTarget: 5,
  requireAllTlds: false,
};

function toRefinementInput(candidates: NameCandidate[]): RefinementInputName[] {
  return candidates.map((candidate) => ({
    base: candidate.base,
    domains: candidate.domains.map((domain) => ({
      domain: domain.domain,
      available: domain.available,
    })),
  }));
}

function formatPremiumPrice(price: number | undefined): string {
  if (price == null || !Number.isFinite(price)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

function fallbackLabel(id: string): string {
  const labels: Record<string, string> = {
    allowDictionaryWords: "dictionary words allowed",
    increaseSyllables: "higher max syllables",
    increaseLength: "higher max length",
    higherTemperature: "higher creativity (temperature)",
    fewerAvoidWords: "fewer avoided words",
    lastResort: "multiple relaxed criteria (dictionary words, longer names, higher creativity)",
  };
  return labels[id] ?? id;
}

function toSavedItem(
  candidate: NameCandidate,
  meta: GenerateResponseBody["meta"] | null,
): Omit<SavedName, "id" | "savedAt"> {
  const rec = meta?.recommendations?.find((r: NameRecommendation) => r.base === candidate.base);
  return {
    base: candidate.base,
    domains: candidate.domains,
    rationale: candidate.rationale,
    score: candidate.score,
    summaryConclusion: meta?.summary,
    recommendationReason: rec?.reason,
  };
}

export default function Home(): React.JSX.Element {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [results, setResults] = useState<NameCandidate[]>([]);
  const [meta, setMeta] = useState<GenerateResponseBody["meta"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [savedNames, setSavedNames] = useState<SavedName[]>([]);
  const [savedSearch, setSavedSearch] = useState("");
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activityLogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSavedNames(getSavedNames());
  }, []);

  useEffect(() => {
    if (activityLogRef.current) {
      activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight;
    }
  }, [progressLog]);

  const availableCount = useMemo(
    () =>
      results.reduce(
        (acc, candidate) =>
          acc + candidate.domains.filter((domain) => domain.available).length,
        0,
      ),
    [results],
  );

  const filteredSaved = useMemo(() => {
    const q = savedSearch.trim().toLowerCase();
    if (!q) return savedNames;
    return savedNames.filter(
      (s) =>
        s.base.toLowerCase().includes(q) ||
        s.rationale?.toLowerCase().includes(q) ||
        s.recommendationReason?.toLowerCase().includes(q),
    );
  }, [savedNames, savedSearch]);

  const selectedSaved = useMemo(
    () => (selectedSavedId ? savedNames.find((s) => s.id === selectedSavedId) : null),
    [savedNames, selectedSavedId],
  );

  const handleSaveOne = useCallback(
    (candidate: NameCandidate) => {
      const item = addSavedName(toSavedItem(candidate, meta));
      setSavedNames((prev) => [item, ...prev]);
      setSelectedSavedId(item.id);
    },
    [meta],
  );

  const handleSaveAll = useCallback(() => {
    addSavedNames(results.map((c) => toSavedItem(c, meta)));
    setSavedNames(() => getSavedNames());
  }, [results, meta]);

  const handleRemoveSaved = useCallback((id: string) => {
    removeSavedName(id);
    setSavedNames(() => getSavedNames());
    if (selectedSavedId === id) setSelectedSavedId(null);
  }, [selectedSavedId]);

  const sendChat = async (): Promise<void> => {
    const msg = chatInput.trim();
    if (!msg || !results.length || chatLoading) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          names: results,
          message: msg,
          history: chatMessages,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Chat failed.");
      }
      const payload = (await response.json()) as { reply: string };
      setChatMessages((prev) => [...prev, { role: "assistant", content: payload.reply }]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Chat failed.";
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const onTldToggle = (tld: string, checked: boolean): void => {
    setForm((prev) => {
      const nextTlds = checked
        ? Array.from(new Set([...prev.tlds, tld]))
        : prev.tlds.filter((value) => value !== tld);
      return {
        ...prev,
        tlds: nextTlds,
      };
    });
  };

  const stopGenerating = (): void => {
    abortControllerRef.current?.abort();
  };

  const submit = async (refine: boolean): Promise<void> => {
    setError(null);
    setProgressLog([]);
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    setLoading(true);
    setIsRefining(refine);
    try {
      const response = await fetch("/api/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: form.description,
          referenceDomain: form.referenceDomain.trim() || undefined,
          industry: form.industry || undefined,
          tone: form.tone || undefined,
          maxLength: form.maxLength,
          maxSyllables: form.maxSyllables,
          avoidDictionaryWords: form.avoidDictionaryWords,
          avoidWords: form.avoidWords
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          tlds: form.tlds,
          temperature: form.temperature,
          count: form.count,
          includePrefixVariants: form.includePrefixVariants,
          minPremiumTarget: form.minPremiumTarget,
          requireAllTlds: form.requireAllTlds,
          refineFrom: refine
            ? {
                namesWithAvailability: toRefinementInput(results),
              }
            : undefined,
        }),
        signal,
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Generation failed.");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        throw new Error("No response body.");
      }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            if (raw === "[DONE]") continue;
            try {
              const data = JSON.parse(raw) as { type: string; message?: string; result?: GenerateResponseBody; error?: string };
              if (data.type === "progress" && typeof data.message === "string") {
                setProgressLog((prev) => [...prev, data.message!]);
              } else if (data.type === "result" && data.result) {
                setResults(data.result.names);
                setMeta(data.result.meta);
                setChatMessages([]);
              } else if (data.type === "error" && typeof data.error === "string") {
                setError(data.error);
              }
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
    } catch (submitError) {
      if (submitError instanceof Error && submitError.name === "AbortError") {
        setError("Generation stopped.");
      } else {
        const message =
          submitError instanceof Error
            ? submitError.message
            : "Unexpected request error.";
        setError(message);
      }
    } finally {
      setLoading(false);
      setIsRefining(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-[var(--background)]">
      {/* Left nav: saved names + search */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--card-border)] bg-[var(--card)]">
        <div className="sticky top-0 border-b border-[var(--card-border)] p-3">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Saved names</h2>
          <input
            type="search"
            value={savedSearch}
            onChange={(e) => setSavedSearch(e.target.value)}
            placeholder="Search saved…"
            className="mt-2 w-full rounded-md border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--primary)]"
            aria-label="Search saved names"
          />
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {filteredSaved.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--muted)]">
              {savedSearch.trim() ? "No matches." : "No saved names yet. Save from results."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filteredSaved.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedSavedId(s.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm font-mono transition-colors ${
                      selectedSavedId === s.id
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "text-[var(--foreground)] hover:bg-[var(--background)]"
                    }`}
                  >
                    {s.base}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-8 bg-[var(--background)]">
      {/* Selected saved name detail */}
      {selectedSaved ? (
        <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Saved: {selectedSaved.base}</h2>
              {selectedSaved.summaryConclusion ? (
                <div className="mt-3 rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Summary conclusion (from run)</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">{selectedSaved.summaryConclusion}</p>
                </div>
              ) : null}
              {selectedSaved.recommendationReason ? (
                <p className="mt-2 text-sm text-[var(--foreground)]">{selectedSaved.recommendationReason}</p>
              ) : null}
              {selectedSaved.rationale ? (
                <p className="mt-1 text-sm text-[var(--muted)]">{selectedSaved.rationale}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedSaved.domains.map((d) => {
                  const isPremium = Boolean(d.premium);
                  const chipClass = d.available
                    ? isPremium
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-[var(--background)] text-[var(--muted)]";
                  return (
                    <span
                      key={d.domain}
                      className={`inline-flex rounded px-2 py-0.5 font-mono text-xs ${chipClass}`}
                    >
                      {d.domain}
                      {d.available && isPremium ? " (premium)" : ""}
                      {!d.available ? " (taken)" : ""}
                    </span>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">Score: {selectedSaved.score} · Saved {new Date(selectedSaved.savedAt).toLocaleString()}</p>
            </div>
            <button
              type="button"
              onClick={() => handleRemoveSaved(selectedSaved.id)}
              className="shrink-0 rounded p-2 text-[var(--muted)] hover:bg-[var(--background)] hover:text-red-600"
              title="Remove from saved"
              aria-label="Remove from saved"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">AI-Powered Brand Name Generator</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Generate domain-ready names, check live availability, and refine toward
          higher hit rates.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">Brand Description</span>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              rows={4}
              placeholder="Describe your product, audience, and vibe..."
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">Industry (optional)</span>
            <input
              value={form.industry}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, industry: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">Reference domain (optional)</span>
            <input
              value={form.referenceDomain}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, referenceDomain: event.target.value }))
              }
              placeholder="example.com"
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">Tone</span>
            <select
              value={form.tone}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, tone: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            >
              <option value="bold">bold</option>
              <option value="technical">technical</option>
              <option value="playful">playful</option>
              <option value="premium">premium</option>
              <option value="professional">professional</option>
              <option value="modern">modern</option>
              <option value="minimal">minimal</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">Max length</span>
            <input
              type="number"
              min={4}
              max={20}
              value={form.maxLength}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  maxLength: Number(event.target.value),
                }))
              }
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">Max syllables</span>
            <input
              type="number"
              min={1}
              max={6}
              value={form.maxSyllables}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  maxSyllables: Number(event.target.value),
                }))
              }
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">Names per batch</span>
            <input
              type="number"
              min={50}
              max={200}
              value={form.count}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  count: Number(event.target.value),
                }))
              }
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>

          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">
              Avoid words (comma-separated)
            </span>
            <input
              value={form.avoidWords}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, avoidWords: event.target.value }))
              }
              placeholder="cloud, open, data"
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-[var(--foreground)]">Temperature: {form.temperature}</p>
            <input
              type="range"
              min={0.3}
              max={1.2}
              step={0.05}
              value={form.temperature}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  temperature: Number(event.target.value),
                }))
              }
              className="w-full accent-[var(--primary)]"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[var(--foreground)]">TLDs</p>
            <div className="flex gap-4">
              {["com", "ai", "io", "co"].map((tld) => (
                <label key={tld} className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={form.tlds.includes(tld)}
                    onChange={(event) => onTldToggle(tld, event.target.checked)}
                    className="accent-[var(--primary)]"
                  />
                  .{tld}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">Show names that have at least one of these available. Option below to require all.</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={form.requireAllTlds}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, requireAllTlds: event.target.checked }))
              }
              className="accent-[var(--primary)]"
            />
            Require all selected TLDs (only show names where every selected TLD is available)
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={form.avoidDictionaryWords}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  avoidDictionaryWords: event.target.checked,
                }))
              }
              className="accent-[var(--primary)]"
            />
            Avoid dictionary words
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={form.includePrefixVariants}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  includePrefixVariants: event.target.checked,
                }))
              }
              className="accent-[var(--primary)]"
            />
            Include get/try prefix variants
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <span>Min .com/.ai target:</span>
            <input
              type="number"
              min={0}
              max={50}
              value={form.minPremiumTarget}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, minPremiumTarget: Number(e.target.value) || 0 }))
              }
              className="w-16 rounded-md border border-[var(--card-border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)]"
            />
            <span className="text-[var(--muted)]">(0 = off, keep generating until this many have .com or .ai)</span>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => (loading && !isRefining ? stopGenerating() : submit(false))}
            disabled={!loading && (!form.description.trim() || form.tlds.length === 0)}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && !isRefining ? (
              <>
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </>
            ) : (
              "Generate"
            )}
          </button>
          <button
            type="button"
            onClick={() => (loading && isRefining ? stopGenerating() : submit(true))}
            disabled={!loading && (results.length === 0)}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && isRefining ? (
              <>
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </>
            ) : (
              "Refine Based on Available"
            )}
          </button>
        </div>
        {loading ? (
          <div className="mt-4 rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Activity</p>
            <div
              ref={activityLogRef}
              className="activity-log max-h-40 overflow-y-auto overflow-x-hidden font-mono text-sm text-[var(--foreground)]"
            >
              {progressLog.length === 0 ? (
                <div className="py-0.5 text-[var(--muted)]">Preparing…</div>
              ) : (
                progressLog.map((msg, i) => (
                  <div key={i} className="py-0.5">
                    {msg}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Results</h2>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-[var(--muted)]">
              {meta
                ? `${meta.generatedCount} names, ${availableCount} available domains${meta.comAvailableCount != null ? `, ${meta.comAvailableCount} with .com` : ""}${meta.aiAvailableCount != null ? `, ${meta.aiAvailableCount} with .ai` : ""}${meta.premiumAvailableCount != null ? `, ${meta.premiumAvailableCount} with .com/.ai` : ""}${meta.refinementRounds != null && meta.refinementRounds > 0 ? ` (${meta.refinementRounds} refinement round${meta.refinementRounds === 1 ? "" : "s"})` : ""}, ${(meta.availabilityRate * 100).toFixed(1)}% hit rate`
                : "No results yet"}
            </p>
            {results.length > 0 ? (
              <button
                type="button"
                onClick={handleSaveAll}
                className="shrink-0 rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card-border)]"
              >
                Save all
              </button>
            ) : null}
          </div>
        </div>
        {meta && meta.generatedCount > 0 && results.length === 0 && !meta.relaxedTldFilter ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-[var(--foreground)]">
              We generated and checked <strong>{meta.generatedCount} names</strong>, but {form.requireAllTlds ? <><strong>none had all of your selected TLDs</strong> (e.g. both .com and .ai) available at once.</> : <><strong>none had any of your selected TLDs</strong> available.</>} So there’s nothing to show in the table. Try &quot;Refine Based on Available&quot; after a run that had some availability, or relax criteria (e.g. allow dictionary words, higher temperature) and generate again.
            </p>
          </div>
        ) : null}

        {(meta?.fallbackUsed || meta?.relaxedTldFilter) ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-[var(--foreground)]">
              {meta.relaxedTldFilter && meta.fallbackUsed
                ? "No names had all selected TLDs available. Ran a fallback with relaxed criteria and are showing names that have at least one of your selected TLDs."
                : meta.relaxedTldFilter
                  ? "No names had all selected TLDs available. Showing names that have at least one of your selected TLDs."
                  : meta.fallbackUsed
                    ? `No results with your exact criteria. Ran another cycle with relaxed settings: ${fallbackLabel(meta.fallbackUsed)}.`
                    : null}
            </p>
          </div>
        ) : null}

        {meta?.summary ? (
          <div className="mt-4 rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Summary conclusion</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">{meta.summary}</p>
          </div>
        ) : null}

        {meta?.recommendations?.length ? (
          <div className="mt-4 rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Top recommendations</h3>
            <ul className="mt-2 grid gap-2">
              {meta.recommendations.map((rec) => {
                const candidate = results.find((c) => c.base === rec.base);
                const copyText = `${rec.base}\n${rec.reason}`;
                const copyRecommendation = (): void => {
                  void navigator.clipboard.writeText(copyText);
                };
                return (
                  <li
                    key={`${rec.base}-${rec.reason}`}
                    className="rounded-md border border-[var(--card-border)] bg-[var(--card)] p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-medium text-[var(--foreground)]">{rec.base}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">{rec.reason}</p>
                        {candidate ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {candidate.domains.map((d) => {
                              const isPremium = Boolean(d.premium);
                              const priceStr = formatPremiumPrice(d.price);
                              const tooltip = d.available
                                ? isPremium
                                  ? priceStr
                                    ? `Available for purchase at premium price: ${priceStr}`
                                    : "Available for purchase at premium price (e.g. aftermarket)"
                                  : "Available"
                                : "Taken";
                              const chipClass = d.available
                                ? isPremium
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : "bg-red-100 text-red-800 line-through dark:bg-red-900/40 dark:text-red-300";
                              return (
                                <span
                                  key={d.domain}
                                  className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-xs ${chipClass}`}
                                  title={tooltip}
                                >
                                  {d.domain}
                                  {d.available ? (isPremium ? (priceStr ? ` (premium – ${priceStr})` : " (premium – price on request)") : "") : " (taken)"}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={copyRecommendation}
                        className="shrink-0 rounded p-1.5 text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                        title="Copy name and reason"
                        aria-label="Copy"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16V4a2 2 0 0 1 2-2h10"/></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => candidate && handleSaveOne(candidate)}
                        className="shrink-0 rounded p-1.5 text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                        title="Save this name"
                        aria-label="Save"
                        disabled={!candidate}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto">
          <p className="mb-2 text-xs text-[var(--muted)]">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/80 align-middle mr-1" aria-hidden /> Available
            {" · "}
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-500/80 align-middle mr-1" aria-hidden /> Premium (available but for sale at higher price, e.g. aftermarket)
            {" · "}
            <span className="inline-block w-3 h-3 rounded-sm bg-[var(--muted)] align-middle mr-1" aria-hidden /> Taken
            {" · "}
            Dollar amounts show when your domain service returns a price (e.g. <code className="rounded bg-[var(--background)] px-1">price</code> or <code className="rounded bg-[var(--background)] px-1">priceUsd</code>).
          </p>
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--card-border)]">
                <th className="px-2 py-2 font-medium text-[var(--foreground)]">Base</th>
                <th className="px-2 py-2 font-medium text-[var(--foreground)]">Domains</th>
                <th className="px-2 py-2 font-medium text-[var(--foreground)]">Rationale</th>
                <th className="px-2 py-2 font-medium text-[var(--foreground)]">Score</th>
                <th className="w-10 px-2 py-2" aria-label="Save" />
              </tr>
            </thead>
            <tbody>
              {results.map((candidate) => (
                <tr key={candidate.base} className="border-b border-[var(--card-border)]/60 align-top">
                  <td className="px-2 py-2 font-mono text-[var(--foreground)]">{candidate.base}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      {candidate.domains.map((domain) => {
                        const isAvailable = domain.available;
                        const isPremium = Boolean(domain.premium);
                        const priceStr = formatPremiumPrice(domain.price);
                        const domainTooltip = isAvailable
                          ? isPremium
                            ? priceStr
                              ? `Available for purchase at premium price: ${priceStr}`
                              : "Available for purchase at premium price (e.g. aftermarket)"
                            : "Available"
                          : domain.status === "error"
                            ? "Error checking availability"
                            : "Taken";
                        const badgeClass = isAvailable
                          ? isPremium
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : domain.status === "error"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-[var(--background)] text-[var(--muted)]";
                        return (
                          <span
                            key={`${candidate.base}-${domain.domain}`}
                            className={`inline-block rounded-md px-2 py-1 font-mono text-xs ${badgeClass}`}
                            title={domainTooltip}
                          >
                            {domain.domain}
                            {isPremium ? (priceStr ? ` (premium – ${priceStr})` : " (premium – price on request)") : ""}
                            {!isAvailable && domain.status === "taken" ? " (taken)" : ""}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[var(--muted)]">
                    {candidate.rationale ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-[var(--foreground)]">{candidate.score}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => handleSaveOne(candidate)}
                      className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                      title="Save this name"
                      aria-label="Save"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {results.length > 0 ? (
        <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Ask about these names</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Query the set of {results.length} names (e.g. “Which are shortest?”, “List names with .com or .ai available”, “Group by style”).
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[320px] rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-3">
              {chatMessages.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No messages yet. Ask a question above.</p>
              ) : (
                chatMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        m.role === "user"
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "bg-[var(--background)] text-[var(--foreground)] border border-[var(--card-border)]"
                      }`}
                    >
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    </div>
                  </div>
                ))
              )}
              {chatLoading ? (
                <p className="text-sm text-[var(--muted)]">Thinking...</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
                placeholder="e.g. Which names have .com or .ai available?"
                className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                disabled={chatLoading}
              />
              <button
                type="button"
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
    </div>
  );
}
