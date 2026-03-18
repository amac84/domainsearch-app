"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { addSavedName, addSavedNames, getSavedNames, removeSavedName } from "@/lib/saved-storage";
import type { GenerateResponseBody, NameCandidate, NameRecommendation, RefinementInputName, SavedName } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Copy, ChevronDown, Save, Square, Sparkles, Trash2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
    <div className="flex min-h-screen w-full bg-background">
      {/* Left nav: saved names + search */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/50">
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </div>
              <span className="font-semibold text-foreground">Naming Lab</span>
            </div>
            <ThemeToggle />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Saved names</p>
          <Input
            type="search"
            value={savedSearch}
            onChange={(e) => setSavedSearch(e.target.value)}
            placeholder="Search saved…"
            className="mt-2"
            aria-label="Search saved names"
          />
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {filteredSaved.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {savedSearch.trim() ? "No matches." : "No saved names yet. Save from results."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filteredSaved.map((s) => (
                <li key={s.id}>
                  <Button
                    type="button"
                    variant={selectedSavedId === s.id ? "default" : "ghost"}
                    className="w-full justify-start font-mono"
                    onClick={() => setSelectedSavedId(s.id)}
                  >
                    {s.base}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Hero strip */}
        <div className="border-b border-border/60 bg-gradient-to-b from-muted/40 to-transparent px-6 py-10 md:py-14">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              AI-powered brand names
            </h1>
            <p className="mt-2 text-muted-foreground md:text-lg">
              Describe your product. Get domain-ready names and live availability in one go.
            </p>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
      {/* Selected saved name detail */}
      {selectedSaved ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle>Saved: {selectedSaved.base}</CardTitle>
              {selectedSaved.summaryConclusion ? (
                <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Summary conclusion (from run)</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedSaved.summaryConclusion}</p>
                </div>
              ) : null}
              {selectedSaved.recommendationReason ? (
                <p className="text-sm text-foreground">{selectedSaved.recommendationReason}</p>
              ) : null}
              {selectedSaved.rationale ? (
                <p className="text-sm text-muted-foreground">{selectedSaved.rationale}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedSaved.domains.map((d) => {
                  const isPremium = Boolean(d.premium);
                  const variant = d.available
                    ? isPremium
                      ? "secondary"
                      : "default"
                    : "outline";
                  return (
                    <Badge key={d.domain} variant={variant} className="font-mono">
                      {d.domain}
                      {d.available && isPremium ? " (premium)" : ""}
                      {!d.available ? " (taken)" : ""}
                    </Badge>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Score: {selectedSaved.score} · Saved {new Date(selectedSaved.savedAt).toLocaleString()}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveSaved(selectedSaved.id)}
              className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Remove from saved"
              aria-label="Remove from saved"
            >
              <Trash2 className="size-4" />
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="overflow-hidden border-0 shadow-lg shadow-black/5 dark:shadow-none dark:ring-1 dark:ring-border">
        <CardContent className="p-0">
          {/* Primary focus: one prompt + tone + actions */}
          <div className="p-6 md:p-8">
            <Label htmlFor="description" className="text-muted-foreground text-sm">
              What are you building?
            </Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={4}
              placeholder="e.g. A calm, premium app for tracking habits. Audience: busy professionals who want simplicity."
              className="mt-2 min-h-[120px] resize-y border-0 bg-muted/40 text-base placeholder:text-muted-foreground focus-visible:ring-2 md:min-h-[100px]"
            />
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Tone:</span>
                <Select
                  value={form.tone}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, tone: value ?? prev.tone }))
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Tone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bold">Bold</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="playful">Playful</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="minimal">Minimal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="lg"
                onClick={() => (loading && !isRefining ? stopGenerating() : submit(false))}
                disabled={!loading && (!form.description.trim() || form.tlds.length === 0)}
                className="gap-2"
              >
                {loading && !isRefining ? (
                  <>
                    <Square className="size-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Generate names
                  </>
                )}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => (loading && isRefining ? stopGenerating() : submit(true))}
                disabled={!loading && results.length === 0}
                className="gap-2"
              >
                {loading && isRefining ? (
                  <>
                    <Square className="size-4" />
                    Stop
                  </>
                ) : (
                  "Refine from results"
                )}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="border-t border-border px-6 py-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Activity</p>
              <div
                ref={activityLogRef}
                className="activity-log max-h-40 overflow-y-auto overflow-x-hidden font-mono text-sm"
              >
                {progressLog.length === 0 ? (
                  <div className="py-0.5 text-muted-foreground">Preparing…</div>
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

          {/* Advanced options: collapsible */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-border">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
              <span>Advanced options</span>
              <ChevronDown className={`size-4 shrink-0 transition-transform duration-200 ${advancedOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-6 border-t border-border bg-muted/20 px-6 py-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="industry">Industry (optional)</Label>
            <Input
              id="industry"
              value={form.industry}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, industry: event.target.value }))
              }
              placeholder="e.g. SaaS, fintech"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="referenceDomain">Reference domain (optional)</Label>
            <Input
              id="referenceDomain"
              value={form.referenceDomain}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, referenceDomain: event.target.value }))
              }
              placeholder="example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxLength">Max length</Label>
            <Input
              id="maxLength"
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
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxSyllables">Max syllables</Label>
            <Input
              id="maxSyllables"
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
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="count">Names per batch</Label>
            <Input
              id="count"
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
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="avoidWords">Avoid words (comma-separated)</Label>
            <Input
              id="avoidWords"
              value={form.avoidWords}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, avoidWords: event.target.value }))
              }
              placeholder="cloud, open, data"
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <Label>Temperature: {form.temperature}</Label>
            <Slider
              min={0.3}
              max={1.2}
              step={0.05}
              value={[form.temperature]}
              onValueChange={(values) => {
                const v = Array.isArray(values) ? values[0] : values;
                setForm((prev) => ({
                  ...prev,
                  temperature: typeof v === "number" ? v : prev.temperature,
                }));
              }}
            />
          </div>

          <div className="space-y-3">
            <Label>TLDs</Label>
            <div className="flex flex-wrap gap-4">
              {["com", "ai", "io", "co"].map((tld) => (
                <label key={tld} className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <Checkbox
                    checked={form.tlds.includes(tld)}
                    onCheckedChange={(checked) => onTldToggle(tld, checked === true)}
                  />
                  .{tld}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">At least one of these available.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox
              checked={form.requireAllTlds}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, requireAllTlds: checked === true }))
              }
            />
            Require all selected TLDs
          </label>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox
              checked={form.avoidDictionaryWords}
              onCheckedChange={(checked) =>
                setForm((prev) => ({
                  ...prev,
                  avoidDictionaryWords: checked === true,
                }))
              }
            />
            Avoid dictionary words
          </label>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox
              checked={form.includePrefixVariants}
              onCheckedChange={(checked) =>
                setForm((prev) => ({
                  ...prev,
                  includePrefixVariants: checked === true,
                }))
              }
            />
            Include get/try prefix variants
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <span>Min .com/.ai target:</span>
            <Input
              type="number"
              min={0}
              max={50}
              className="w-20"
              value={form.minPremiumTarget}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, minPremiumTarget: Number(e.target.value) || 0 }))
              }
            />
            <span className="text-muted-foreground text-xs">(0 = off)</span>
          </label>
        </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {error ? (
            <div className="border-t border-border px-6 py-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
          <CardTitle>Results</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {meta
                ? `${meta.generatedCount} names, ${availableCount} available domains${meta.comAvailableCount != null ? `, ${meta.comAvailableCount} with .com` : ""}${meta.aiAvailableCount != null ? `, ${meta.aiAvailableCount} with .ai` : ""}${meta.premiumAvailableCount != null ? `, ${meta.premiumAvailableCount} with .com/.ai` : ""}${meta.refinementRounds != null && meta.refinementRounds > 0 ? ` (${meta.refinementRounds} refinement round${meta.refinementRounds === 1 ? "" : "s"})` : ""}, ${(meta.availabilityRate * 100).toFixed(1)}% hit rate`
                : "No results yet"}
            </p>
            {results.length > 0 ? (
              <Button variant="outline" size="sm" onClick={handleSaveAll}>
                <Save className="size-4" />
                Save all
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
        {meta && meta.generatedCount > 0 && results.length === 0 && !meta.relaxedTldFilter ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-foreground">
              We generated and checked <strong>{meta.generatedCount} names</strong>, but {form.requireAllTlds ? <><strong>none had all of your selected TLDs</strong> (e.g. both .com and .ai) available at once.</> : <><strong>none had any of your selected TLDs</strong> available.</>} So there’s nothing to show in the table. Try &quot;Refine Based on Available&quot; after a run that had some availability, or relax criteria (e.g. allow dictionary words, higher temperature) and generate again.
            </p>
          </div>
        ) : null}

        {(meta?.fallbackUsed || meta?.relaxedTldFilter) ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-foreground">
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
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Summary conclusion</h3>
            <p className="mt-1 text-sm text-muted-foreground">{meta.summary}</p>
          </div>
        ) : null}

        {meta?.recommendations?.length ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Top recommendations</h3>
            <ul className="mt-3 grid gap-2">
              {meta.recommendations.map((rec) => {
                const candidate = results.find((c) => c.base === rec.base);
                const copyText = `${rec.base}\n${rec.reason}`;
                const copyRecommendation = (): void => {
                  void navigator.clipboard.writeText(copyText);
                };
                return (
                  <li
                    key={`${rec.base}-${rec.reason}`}
                    className="flex items-start justify-between gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium text-foreground">{rec.base}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{rec.reason}</p>
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
                            const variant = d.available
                              ? isPremium
                                ? "secondary"
                                : "default"
                              : "outline";
                            return (
                              <Badge
                                key={d.domain}
                                variant={variant}
                                className="font-mono"
                                title={tooltip}
                              >
                                {d.domain}
                                {d.available ? (isPremium ? (priceStr ? ` (premium – ${priceStr})` : " (premium – price on request)") : "") : " (taken)"}
                              </Badge>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" onClick={copyRecommendation} title="Copy name and reason" aria-label="Copy">
                        <Copy className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => candidate && handleSaveOne(candidate)}
                        title="Save this name"
                        aria-label="Save"
                        disabled={!candidate}
                      >
                        <Save className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="inline-block size-3 rounded-sm bg-emerald-500/80 align-middle mr-1" aria-hidden /> Available
            {" · "}
            <span className="inline-block size-3 rounded-sm bg-amber-500/80 align-middle mr-1" aria-hidden /> Premium
            {" · "}
            <span className="inline-block size-3 rounded-sm bg-muted align-middle mr-1" aria-hidden /> Taken
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 font-medium text-foreground">Base</th>
                  <th className="px-4 py-3 font-medium text-foreground">Domains</th>
                  <th className="px-4 py-3 font-medium text-foreground">Rationale</th>
                  <th className="px-4 py-3 font-medium text-foreground">Score</th>
                  <th className="w-12 px-4 py-3" aria-label="Save" />
                </tr>
              </thead>
              <tbody>
                {results.map((candidate) => (
                  <tr key={candidate.base} className="border-b border-border/60 align-top transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-foreground">{candidate.base}</td>
                    <td className="px-4 py-3">
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
                          const badgeVariant = isAvailable
                            ? isPremium
                              ? "secondary"
                              : "default"
                            : domain.status === "error"
                              ? "secondary"
                              : "outline";
                          return (
                            <Badge
                              key={`${candidate.base}-${domain.domain}`}
                              variant={badgeVariant}
                              className="w-fit font-mono"
                              title={domainTooltip}
                            >
                              {domain.domain}
                              {isPremium ? (priceStr ? ` (premium – ${priceStr})` : " (premium – price on request)") : ""}
                              {!isAvailable && domain.status === "taken" ? " (taken)" : ""}
                            </Badge>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {candidate.rationale ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-foreground">{candidate.score}</td>
                    <td className="px-4 py-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSaveOne(candidate)}
                        title="Save this name"
                        aria-label="Save"
                      >
                        <Save className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </CardContent>
      </Card>

      {results.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ask about these names</CardTitle>
            <CardDescription>
            Query the set of {results.length} names (e.g. “Which are shortest?”, “List names with .com or .ai available”, “Group by style”).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[320px] rounded-lg border border-border bg-muted/30 p-3">
              {chatMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages yet. Ask a question below.</p>
              ) : (
                chatMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground border border-border"
                      }`}
                    >
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    </div>
                  </div>
                ))
              )}
              {chatLoading ? (
                <p className="text-sm text-muted-foreground">Thinking...</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
                placeholder="e.g. Which names have .com or .ai available?"
                disabled={chatLoading}
                className="flex-1"
              />
              <Button
                type="button"
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
              >
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
        </div>
    </main>
    </div>
  );
}
