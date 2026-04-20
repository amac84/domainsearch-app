"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AuthRequiredError as SearchHistoryAuthRequiredError,
  clearSearchHistoryEntries,
  createSearchHistoryEntry,
  deleteSearchHistoryEntry,
  fetchSearchHistory,
} from "@/lib/search-history-api";
import {
  AuthRequiredError as SavedNamesAuthRequiredError,
  createSavedName,
  createSavedNames,
  deleteSavedName,
  fetchSavedNames,
} from "@/lib/saved-names-api";
import {
  dismissFeedbackAcknowledgement,
  fetchFeedbackImpact,
  type FeedbackImpactItem,
  submitSuggestion,
} from "@/lib/suggestions-api";
import type {
  GenerateResponseBody,
  NameCandidate,
  NameRecommendation,
  RefinementInputName,
  SavedName,
  SearchHistoryEntry,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BubbleSelect } from "@/components/bubble-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Copy, ChevronDown, CircleHelp, Save, Square, Sparkles, Trash2, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

interface FormState {
  description: string;
  referenceDomain: string;
  industry: string;
  tone: string[];
  nameStyle: string[];
  wordConstraint: "oneWord" | "twoWord";
  syllableConstraint: "any" | "two";
  wordTypeConstraint: "mixed" | "invented" | "dictionary";
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

interface ChatSuggestion {
  label: string;
  description?: string | null;
  tone?: string[] | null;
  nameStyle?: string[] | null;
  wordConstraint?: "oneWord" | "twoWord" | null;
  syllableConstraint?: "any" | "two" | null;
  wordTypeConstraint?: "mixed" | "invented" | "dictionary" | null;
  maxLength?: number | null;
  maxSyllables?: number | null;
  avoidDictionaryWords?: boolean | null;
  avoidWords?: string[] | null;
  tlds?: string[] | null;
  temperature?: number | null;
  count?: number | null;
  includePrefixVariants?: boolean | null;
  minPremiumTarget?: number | null;
  requireAllTlds?: boolean | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: ChatSuggestion | null;
}

function mergeFormWithSuggestion(prev: FormState, suggestion: ChatSuggestion): FormState {
  const mergedAvoidWords =
    suggestion.avoidWords && suggestion.avoidWords.length > 0
      ? Array.from(
          new Set(
            [
              ...prev.avoidWords
                .split(",")
                .map((w) => w.trim().toLowerCase())
                .filter(Boolean),
              ...suggestion.avoidWords.map((w) => w.trim().toLowerCase()).filter(Boolean),
            ],
          ),
        ).join(", ")
      : prev.avoidWords;

  return {
    ...prev,
    description: suggestion.description ?? prev.description,
    tone: suggestion.tone && suggestion.tone.length > 0 ? suggestion.tone : prev.tone,
    nameStyle:
      suggestion.nameStyle && suggestion.nameStyle.length > 0
        ? suggestion.nameStyle
        : prev.nameStyle,
    wordConstraint: suggestion.wordConstraint ?? prev.wordConstraint,
    syllableConstraint: suggestion.syllableConstraint ?? prev.syllableConstraint,
    wordTypeConstraint: suggestion.wordTypeConstraint ?? prev.wordTypeConstraint,
    maxLength:
      suggestion.maxLength != null && Number.isFinite(suggestion.maxLength)
        ? Math.min(20, Math.max(4, suggestion.maxLength))
        : prev.maxLength,
    maxSyllables:
      suggestion.maxSyllables != null && Number.isFinite(suggestion.maxSyllables)
        ? Math.min(6, Math.max(1, suggestion.maxSyllables))
        : prev.maxSyllables,
    avoidDictionaryWords: suggestion.avoidDictionaryWords ?? prev.avoidDictionaryWords,
    avoidWords: mergedAvoidWords,
    tlds: suggestion.tlds && suggestion.tlds.length > 0 ? suggestion.tlds : prev.tlds,
    temperature:
      suggestion.temperature != null && Number.isFinite(suggestion.temperature)
        ? Math.min(1.2, Math.max(0.3, suggestion.temperature))
        : prev.temperature,
    count:
      suggestion.count != null && Number.isFinite(suggestion.count)
        ? Math.min(200, Math.max(50, suggestion.count))
        : prev.count,
    includePrefixVariants: suggestion.includePrefixVariants ?? prev.includePrefixVariants,
    minPremiumTarget:
      suggestion.minPremiumTarget != null && Number.isFinite(suggestion.minPremiumTarget)
        ? Math.min(50, Math.max(0, suggestion.minPremiumTarget))
        : prev.minPremiumTarget,
    requireAllTlds: suggestion.requireAllTlds ?? prev.requireAllTlds,
  };
}

// Lunour-style "feelings" — what should someone feel when they hear the name?
// Source: Phase 1 discovery question in lunour-naming.skill.
const VIBE_OPTIONS = [
  {
    value: "trust",
    label: "Trust",
    description: "Safe, credible, established. Sounds investors and finance leads instinctively believe.",
  },
  {
    value: "delight",
    label: "Delight",
    description: "Joyful and light — a small smile on first hearing. Friendly without being silly.",
  },
  {
    value: "power",
    label: "Power",
    description: "Confident, decisive, large in scale. Commands the room without shouting.",
  },
  {
    value: "safety",
    label: "Safety",
    description: "Calm, protective, dependable. No edges, no friction.",
  },
  {
    value: "curiosity",
    label: "Curiosity",
    description: "Intriguing and a touch unexpected — a name you want to repeat aloud.",
  },
  {
    value: "calm",
    label: "Calm",
    description: "Peaceful, low-pressure, quiet. Open vowels, soft endings.",
  },
  {
    value: "warmth",
    label: "Warmth",
    description: "Human, friendly, approachable. Feels said by a person, not a corporation.",
  },
  {
    value: "precision",
    label: "Precision",
    description: "Exact, engineered, well-built. Suggests logic and craft without sounding cold.",
  },
  {
    value: "mystery",
    label: "Mystery",
    description: "Evocative and a little unknown — leaves room for the brand's story to grow.",
  },
] as const;

// Lunour naming archetypes (references/naming-types.md). Hover for definitions.
const NAME_TYPE_OPTIONS = [
  {
    value: "evocative",
    label: "Evocative",
    description: "Names that conjure a feeling, not the literal product (Stripe, Notion, Loom, Figma).",
  },
  {
    value: "invented",
    label: "Invented",
    description: "Coined words, portmanteaus, engineered sound. Highly ownable (Kodak, Spotify, Verizon).",
  },
  {
    value: "metaphor",
    label: "Metaphor",
    description: "Borrowed from another domain to create resonance (Amazon, Apple, Ribbon, Firefly).",
  },
  {
    value: "experiential",
    label: "Experiential",
    description: "Becomes a verb in everyday speech (Zoom, Uber, Google, Slack).",
  },
  {
    value: "portmanteau",
    label: "Portmanteau",
    description: "Two meaningful words fused with one clear stress (Pinterest, Instagram, Microsoft).",
  },
  {
    value: "abstract",
    label: "Abstract",
    description: "Pure designed sound with no inherent meaning — built up by branding (Accenture, Agilent).",
  },
  {
    value: "place",
    label: "Place",
    description: "Borrows the feeling of a real or imagined location — scale, journey, landscape (Amazon, Patagonia, Atlassian).",
  },
  {
    value: "descriptive",
    label: "Descriptive",
    description: "Says what the product does — easy to grasp, harder to trademark (Basecamp, Dropbox, Salesforce).",
  },
] as const;

const DEFAULT_FORM: FormState = {
  description: "",
  referenceDomain: "",
  industry: "",
  tone: ["trust"],
  nameStyle: ["evocative"],
  wordConstraint: "oneWord",
  syllableConstraint: "any",
  wordTypeConstraint: "invented",
  maxLength: 10,
  maxSyllables: 3,
  avoidDictionaryWords: true,
  avoidWords: "",
  tlds: ["com", "ai"],
  temperature: 1.0,
  count: 50,
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

function scoreBreakdownLabel(candidate: NameCandidate | SavedName): string {
  const s = candidate.scoreBreakdown;
  if (!s) return "";
  return `B ${s.brandability} · P ${s.pronounceability} · L ${s.length} · AI ${s.aiVibe}`;
}

function styleLabel(nameStyle: string | undefined): string {
  const key = (nameStyle ?? "evocative").toLowerCase().replace(/-/g, "");
  const labels: Record<string, string> = {
    evocative: "Evocative",
    invented: "Invented",
    metaphor: "Metaphor",
    experiential: "Experiential",
    portmanteau: "Portmanteau",
    abstract: "Abstract",
    place: "Place",
    descriptive: "Descriptive",
    // Backwards-compat aliases for previously saved searches.
    moderntech: "Evocative",
    futuristicai: "Invented",
    brandable: "Invented",
    professional: "Descriptive",
  };
  return labels[key] ?? "Evocative";
}

function parseToneOrStyleFromHistory(raw: string): string[] {
  if (!raw?.trim()) return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
    } catch {
      /* fall through */
    }
  }
  return [t];
}

function estimateInitialDurationMs(
  form: FormState,
  refine: boolean,
): number {
  const tldCount = Math.max(1, form.tlds.length);
  const complexityScore =
    9000 +
    form.count * 130 +
    tldCount * 2500 +
    (form.referenceDomain.trim() ? 6000 : 0) +
    (refine ? 7000 : 0) +
    (form.requireAllTlds ? 4000 : 0) +
    Math.min(10, form.minPremiumTarget) * 500;
  return Math.min(Math.max(complexityScore, 12000), 180000);
}

function inferProgressRatio(
  progressLog: string[],
): number {
  let ratio = 0.06;
  for (const item of progressLog) {
    const message = item.toLowerCase();
    if (message.includes("starting")) ratio = Math.max(ratio, 0.08);
    if (message.includes("analyzing reference domain")) ratio = Math.max(ratio, 0.14);
    if (message.includes("generating first batch")) ratio = Math.max(ratio, 0.24);
    if (
      message.includes("generated") &&
      message.includes("checking domain availability")
    ) {
      ratio = Math.max(ratio, 0.42);
    }
    if (message.includes("ranking and filtering")) ratio = Math.max(ratio, 0.62);
    if (message.includes("low availability")) ratio = Math.max(ratio, 0.66);
    if (message.includes("checking availability for second batch")) {
      ratio = Math.max(ratio, 0.72);
    }
    if (
      message.includes("refining for more") ||
      message.includes("need more names with")
    ) {
      ratio = Math.max(ratio, 0.74);
    }
    if (message.includes("checking availability for refinement batch")) {
      ratio = Math.max(ratio, 0.78);
    }
    if (message.includes("trying fallback")) ratio = Math.max(ratio, 0.72);
    if (message.includes("last-resort run")) ratio = Math.max(ratio, 0.76);
    if (message.includes("running quality ranking")) ratio = Math.max(ratio, 0.84);
    if (message.includes("filtering by selected tlds")) ratio = Math.max(ratio, 0.93);
  }
  return Math.min(ratio, 0.96);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 5) return "a few seconds";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function toneLabel(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeSuggestion(suggestion: ChatSuggestion): Array<{ label: string; value: string }> {
  const deltas: Array<{ label: string; value: string }> = [];
  if (suggestion.avoidWords && suggestion.avoidWords.length > 0) {
    deltas.push({ label: "Avoid", value: suggestion.avoidWords.join(", ") });
  }
  if (suggestion.tone && suggestion.tone.length > 0) {
    deltas.push({ label: "Tone", value: suggestion.tone.map(toneLabel).join(", ") });
  }
  if (suggestion.nameStyle && suggestion.nameStyle.length > 0) {
    deltas.push({ label: "Archetype", value: suggestion.nameStyle.map(styleLabel).join(", ") });
  }
  if (suggestion.wordTypeConstraint) {
    const map: Record<NonNullable<ChatSuggestion["wordTypeConstraint"]>, string> = {
      invented: "Invented only",
      mixed: "Mixed",
      dictionary: "Dictionary words only",
    };
    deltas.push({ label: "Word type", value: map[suggestion.wordTypeConstraint] });
  }
  if (suggestion.wordConstraint) {
    deltas.push({
      label: "Words",
      value: suggestion.wordConstraint === "oneWord" ? "1-word names" : "2-word names",
    });
  }
  if (suggestion.syllableConstraint === "two") {
    deltas.push({ label: "Syllables", value: "Exactly 2" });
  }
  if (suggestion.maxLength != null) {
    deltas.push({ label: "Max length", value: String(suggestion.maxLength) });
  }
  if (suggestion.maxSyllables != null) {
    deltas.push({ label: "Max syllables", value: String(suggestion.maxSyllables) });
  }
  if (suggestion.tlds && suggestion.tlds.length > 0) {
    deltas.push({
      label: "TLDs",
      value: suggestion.tlds.map((tld) => `.${tld}`).join(", "),
    });
  }
  if (suggestion.requireAllTlds === true) {
    deltas.push({ label: "TLD rule", value: "Require all selected" });
  }
  if (suggestion.minPremiumTarget != null) {
    deltas.push({ label: "Min .com/.ai target", value: String(suggestion.minPremiumTarget) });
  }
  if (suggestion.includePrefixVariants === true) {
    deltas.push({ label: "Prefix variants", value: "Include get/try" });
  }
  if (suggestion.temperature != null) {
    deltas.push({ label: "Temperature", value: suggestion.temperature.toFixed(2) });
  }
  if (suggestion.count != null) {
    deltas.push({ label: "Count", value: String(suggestion.count) });
  }
  return deltas;
}

function historyQueryLabel(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 0 ? trimmed : "Untitled search";
}

function scoreTooltip(candidate: NameCandidate, activeStyle: string | string[]): string {
  const s = candidate.scoreBreakdown;
  if (!s) return "No score breakdown available.";
  const dimensions: Array<{ key: string; value: number }> = [
    { key: "Brandability", value: s.brandability },
    { key: "Pronounceability", value: s.pronounceability },
    { key: "Length fit", value: s.length },
    { key: "AI vibe", value: s.aiVibe },
  ];
  const top = [...dimensions].sort((a, b) => b.value - a.value).slice(0, 2);
  const styleLabels = Array.isArray(activeStyle)
    ? activeStyle.map(styleLabel).join(", ")
    : styleLabel(activeStyle);
  return [
    `Archetype: ${styleLabels}`,
    `Top drivers: ${top.map((d) => `${d.key} (${d.value})`).join(", ")}`,
    `Breakdown: Brandability ${s.brandability}, Pronounceability ${s.pronounceability}, Length ${s.length}, AI vibe ${s.aiVibe}`,
  ].join("\n");
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
    scoreBreakdown: candidate.scoreBreakdown,
    summaryConclusion: meta?.summary,
    recommendationReason: rec?.reason,
  };
}

const AUTH_STATE_SNAPSHOT_KEY = "naming-lab-auth-snapshot-v1";

interface AuthStateSnapshot {
  form: FormState;
  results: NameCandidate[];
  meta: GenerateResponseBody["meta"] | null;
  chatMessages: ChatMessage[];
  searchHistory: SearchHistoryEntry[];
  selectedHistoryId: string | null;
  savedSearch: string;
  selectedSavedId: string | null;
}

function isAuthRequiredError(error: unknown): boolean {
  return (
    error instanceof SavedNamesAuthRequiredError ||
    error instanceof SearchHistoryAuthRequiredError ||
    (error instanceof Error &&
      /authentication required|not authenticated|401/i.test(error.message))
  );
}

function formatAccountDataLoadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unable to load account data.";
  if (/Could not find the table|saved_names|search_history|schema cache/i.test(raw)) {
    return "Saved names and history need database tables. In Supabase → SQL Editor, run docs/supabase-schema.sql from this repository, then refresh this page.";
  }
  return raw;
}

export default function Home(): React.JSX.Element {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userFirstName, setUserFirstName] = useState<string | null>(null);
  const [results, setResults] = useState<NameCandidate[]>([]);
  const [meta, setMeta] = useState<GenerateResponseBody["meta"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [savedNames, setSavedNames] = useState<SavedName[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [savedSearch, setSavedSearch] = useState("");
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"form" | "results">("form");
  const [savingStateError, setSavingStateError] = useState<string | null>(null);
  const [suggestionTitle, setSuggestionTitle] = useState("");
  const [suggestionDescription, setSuggestionDescription] = useState("");
  const [suggestionSubmitting, setSuggestionSubmitting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionIssue, setSuggestionIssue] = useState<{
    identifier: string;
    url: string;
  } | null>(null);
  const [feedbackAcknowledgements, setFeedbackAcknowledgements] = useState<
    FeedbackImpactItem[]
  >([]);
  const [feedbackImpactHistory, setFeedbackImpactHistory] = useState<
    FeedbackImpactItem[]
  >([]);
  const [feedbackImpactError, setFeedbackImpactError] = useState<string | null>(null);
  const [runTiming, setRunTiming] = useState<{
    startedAt: number;
    baseEstimateMs: number;
  } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activityLogRef = useRef<HTMLDivElement | null>(null);
  const resultsSectionRef = useRef<HTMLDivElement | null>(null);

  const persistAuthSnapshot = useCallback(() => {
    if (typeof window === "undefined") return;
    const snapshot: AuthStateSnapshot = {
      form,
      results,
      meta,
      chatMessages,
      searchHistory,
      selectedHistoryId,
      savedSearch,
      selectedSavedId,
    };
    try {
      window.sessionStorage.setItem(
        AUTH_STATE_SNAPSHOT_KEY,
        JSON.stringify(snapshot),
      );
    } catch {
      // ignore storage failures
    }
  }, [
    form,
    results,
    meta,
    chatMessages,
    searchHistory,
    selectedHistoryId,
    savedSearch,
    selectedSavedId,
  ]);

  const redirectToAuthWithSnapshot = useCallback(() => {
    if (typeof window === "undefined") return;
    persistAuthSnapshot();
    const nextPath = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/auth?next=${encodeURIComponent(nextPath)}`);
  }, [persistAuthSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(AUTH_STATE_SNAPSHOT_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as AuthStateSnapshot;
      if (parsed.form) setForm(parsed.form);
      if (Array.isArray(parsed.results)) setResults(parsed.results);
      if (parsed.meta) setMeta(parsed.meta);
      if (Array.isArray(parsed.chatMessages)) setChatMessages(parsed.chatMessages);
      if (Array.isArray(parsed.searchHistory)) setSearchHistory(parsed.searchHistory);
      if (typeof parsed.savedSearch === "string") setSavedSearch(parsed.savedSearch);
      if (typeof parsed.selectedSavedId === "string" || parsed.selectedSavedId === null) {
        setSelectedSavedId(parsed.selectedSavedId);
      }
      if (
        typeof parsed.selectedHistoryId === "string" ||
        parsed.selectedHistoryId === null
      ) {
        setSelectedHistoryId(parsed.selectedHistoryId);
      }
    } catch {
      // ignore malformed snapshot
    } finally {
      window.sessionStorage.removeItem(AUTH_STATE_SNAPSHOT_KEY);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAccountData = async (): Promise<void> => {
      try {
        setSavingStateError(null);
        const userResponse = await fetch("/api/auth/user", { cache: "no-store" });
        if (!userResponse.ok) {
          if (!cancelled) {
            setIsAuthenticated(false);
            setUserEmail(null);
            setUserFirstName(null);
          }
          return;
        }

        const payload = (await userResponse.json()) as {
          user?: {
            email?: string | null;
            firstName?: string | null;
            fullName?: string | null;
          };
        };

        if (cancelled) return;
        setIsAuthenticated(true);
        setUserEmail(payload.user?.email ?? null);
        setUserFirstName(payload.user?.firstName ?? null);

        const syncIssues: string[] = [];
        let authLost = false;

        try {
          setSavedNames(await fetchSavedNames());
        } catch (savedError) {
          if (cancelled) return;
          setSavedNames([]);
          if (isAuthRequiredError(savedError)) {
            authLost = true;
          } else {
            syncIssues.push(formatAccountDataLoadError(savedError));
          }
        }

        if (authLost) {
          if (!cancelled) {
            setIsAuthenticated(false);
            setUserEmail(null);
            setUserFirstName(null);
          }
          return;
        }

        try {
          setSearchHistory(await fetchSearchHistory());
        } catch (historyError) {
          if (cancelled) return;
          setSearchHistory([]);
          if (isAuthRequiredError(historyError)) {
            if (!cancelled) {
              setIsAuthenticated(false);
              setUserEmail(null);
              setUserFirstName(null);
            }
            return;
          }
          syncIssues.push(formatAccountDataLoadError(historyError));
        }

        if (syncIssues.length > 0 && !cancelled) {
          setSavingStateError([...new Set(syncIssues)].join(" "));
        }

        try {
          const feedbackImpact = await fetchFeedbackImpact();
          if (!cancelled) {
            setFeedbackAcknowledgements(feedbackImpact.activeAcknowledgements);
            setFeedbackImpactHistory(feedbackImpact.history);
            setFeedbackImpactError(null);
          }
        } catch (feedbackError) {
          if (!cancelled) {
            const message =
              feedbackError instanceof Error
                ? feedbackError.message
                : "Unable to load feedback impact.";
            setFeedbackImpactError(message);
          }
        }
      } catch (loadError) {
        if (cancelled) return;
        if (isAuthRequiredError(loadError)) {
          setIsAuthenticated(false);
          setUserEmail(null);
          setUserFirstName(null);
          return;
        }
        const message =
          loadError instanceof Error ? loadError.message : "Unable to load your account data.";
        setSavingStateError(message);
      }
    };
    void loadAccountData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activityLogRef.current) {
      activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight;
    }
  }, [progressLog]);

  // On mobile, switch to results tab automatically when generation finishes
  useEffect(() => {
    if (!loading && results.length > 0) {
      setMobileTab("results");
    }
  }, [loading, results.length]);

  useEffect(() => {
    if (!loading || !runTiming) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - runTiming.startedAt);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - runTiming.startedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [loading, runTiming]);

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

  const avoidWordList = useMemo(
    () =>
      Array.from(
        new Set(
          form.avoidWords
            .split(",")
            .map((word) => word.trim())
            .filter(Boolean),
        ),
      ),
    [form.avoidWords],
  );

  const removeAvoidWord = useCallback((word: string): void => {
    const target = word.trim().toLowerCase();
    if (!target) return;
    setForm((prev) => {
      const remaining = prev.avoidWords
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value) => value.toLowerCase() !== target);
      return { ...prev, avoidWords: remaining.join(", ") };
    });
  }, []);

  const clearAvoidWords = useCallback((): void => {
    setForm((prev) => ({ ...prev, avoidWords: "" }));
  }, []);

  const eta = useMemo(() => {
    if (!loading || !runTiming) return null;
    const progressRatio = inferProgressRatio(progressLog);
    const projectedTotalMs = Math.max(
      runTiming.baseEstimateMs,
      elapsedMs / Math.max(progressRatio, 0.08),
    );
    const remainingMs = Math.max(0, projectedTotalMs - elapsedMs);
    return {
      progressRatio,
      remainingLabel: formatDuration(remainingMs),
      elapsedLabel: formatDuration(elapsedMs),
    };
  }, [loading, runTiming, progressLog, elapsedMs]);

  const handleSaveOne = useCallback(
    async (candidate: NameCandidate) => {
      if (!isAuthenticated) {
        setSavingStateError("Sign in to save names. Redirecting to login...");
        redirectToAuthWithSnapshot();
        return;
      }
      try {
        setSavingStateError(null);
        const item = await createSavedName(toSavedItem(candidate, meta));
        setSavedNames((prev) => [item, ...prev]);
        setSelectedSavedId(item.id);
      } catch (saveError) {
        if (isAuthRequiredError(saveError)) {
          setIsAuthenticated(false);
          setUserEmail(null);
          setUserFirstName(null);
          setSavingStateError("Session expired. Redirecting to login...");
          redirectToAuthWithSnapshot();
          return;
        }
        const message =
          saveError instanceof Error ? saveError.message : "Unable to save this name.";
        setSavingStateError(message);
      }
    },
    [isAuthenticated, meta, redirectToAuthWithSnapshot],
  );

  const handleSaveAll = useCallback(async () => {
    if (!isAuthenticated) {
      setSavingStateError("Sign in to save names. Redirecting to login...");
      redirectToAuthWithSnapshot();
      return;
    }
    try {
      setSavingStateError(null);
      const created = await createSavedNames(results.map((c) => toSavedItem(c, meta)));
      setSavedNames((prev) => [...created, ...prev]);
    } catch (saveError) {
      if (isAuthRequiredError(saveError)) {
        setIsAuthenticated(false);
        setUserEmail(null);
        setUserFirstName(null);
        setSavingStateError("Session expired. Redirecting to login...");
        redirectToAuthWithSnapshot();
        return;
      }
      const message =
        saveError instanceof Error ? saveError.message : "Unable to save names.";
      setSavingStateError(message);
    }
  }, [isAuthenticated, meta, redirectToAuthWithSnapshot, results]);

  const handleRemoveSaved = useCallback(async (id: string) => {
    if (!isAuthenticated) return;
    try {
      setSavingStateError(null);
      await deleteSavedName(id);
      setSavedNames((prev) => prev.filter((item) => item.id !== id));
      if (selectedSavedId === id) setSelectedSavedId(null);
    } catch (removeError) {
      if (isAuthRequiredError(removeError)) {
        setIsAuthenticated(false);
        setUserEmail(null);
        setUserFirstName(null);
        setSavingStateError("Session expired. Redirecting to login...");
        redirectToAuthWithSnapshot();
        return;
      }
      const message =
        removeError instanceof Error ? removeError.message : "Unable to remove saved name.";
      setSavingStateError(message);
    }
  }, [isAuthenticated, redirectToAuthWithSnapshot, selectedSavedId]);

  const handleRestoreHistory = useCallback((entry: SearchHistoryEntry) => {
    setSelectedHistoryId(entry.id);
    setResults(entry.names);
    setMeta(entry.meta);
    setError(null);
    setProgressLog([]);
    setChatMessages([]);
    setForm((prev) => ({
      ...prev,
      description: entry.query || prev.description,
      tone: parseToneOrStyleFromHistory(entry.tone).length > 0 ? parseToneOrStyleFromHistory(entry.tone) : prev.tone,
      nameStyle: parseToneOrStyleFromHistory(entry.nameStyle).length > 0 ? parseToneOrStyleFromHistory(entry.nameStyle) : prev.nameStyle,
      tlds: entry.tlds.length > 0 ? entry.tlds : prev.tlds,
    }));
  }, []);

  const handleRemoveHistory = useCallback(async (id: string) => {
    if (!isAuthenticated) {
      setSearchHistory((prev) => {
        const next = prev.filter((entry) => entry.id !== id);
        if (selectedHistoryId === id) {
          setSelectedHistoryId(next[0]?.id ?? null);
        }
        return next;
      });
      return;
    }
    try {
      setSavingStateError(null);
      await deleteSearchHistoryEntry(id);
      setSearchHistory((prev) => {
        const next = prev.filter((entry) => entry.id !== id);
        if (selectedHistoryId === id) {
          setSelectedHistoryId(next[0]?.id ?? null);
        }
        return next;
      });
    } catch (removeError) {
      if (isAuthRequiredError(removeError)) {
        setIsAuthenticated(false);
        setUserEmail(null);
        setUserFirstName(null);
        setSavingStateError("Session expired. Redirecting to login...");
        redirectToAuthWithSnapshot();
        return;
      }
      const message =
        removeError instanceof Error ? removeError.message : "Unable to remove history item.";
      setSavingStateError(message);
    }
  }, [isAuthenticated, redirectToAuthWithSnapshot, selectedHistoryId]);

  const handleClearHistory = useCallback(async () => {
    if (!isAuthenticated) {
      setSearchHistory([]);
      setSelectedHistoryId(null);
      return;
    }
    try {
      setSavingStateError(null);
      await clearSearchHistoryEntries();
      setSearchHistory([]);
      setSelectedHistoryId(null);
    } catch (clearError) {
      if (isAuthRequiredError(clearError)) {
        setIsAuthenticated(false);
        setUserEmail(null);
        setUserFirstName(null);
        setSavingStateError("Session expired. Redirecting to login...");
        redirectToAuthWithSnapshot();
        return;
      }
      const message =
        clearError instanceof Error ? clearError.message : "Unable to clear history.";
      setSavingStateError(message);
    }
  }, [isAuthenticated, redirectToAuthWithSnapshot]);

  const handleSignOut = useCallback(async () => {
    if (!isAuthenticated) {
      redirectToAuthWithSnapshot();
      return;
    }
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      window.location.assign("/auth");
    }
  }, [isAuthenticated, redirectToAuthWithSnapshot]);

  const handleSubmitSuggestion = useCallback(async () => {
    const title = suggestionTitle.trim();
    const description = suggestionDescription.trim();

    if (!title || !description || suggestionSubmitting) return;

    try {
      setSuggestionSubmitting(true);
      setSuggestionError(null);
      setSuggestionIssue(null);
      const issue = await submitSuggestion({ title, description });
      setSuggestionIssue({ identifier: issue.identifier, url: issue.url });
      setSuggestionTitle("");
      setSuggestionDescription("");
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Unable to send suggestion.";
      setSuggestionError(message);
    } finally {
      setSuggestionSubmitting(false);
    }
  }, [suggestionTitle, suggestionDescription, suggestionSubmitting]);

  const handleDismissFeedbackAcknowledgement = useCallback(
    async (feedbackId: string) => {
      try {
        await dismissFeedbackAcknowledgement(feedbackId);
        setFeedbackAcknowledgements((prev) =>
          prev.filter((item) => item.id !== feedbackId),
        );
      } catch (dismissError) {
        const message =
          dismissError instanceof Error
            ? dismissError.message
            : "Unable to dismiss feedback acknowledgement.";
        setFeedbackImpactError(message);
      }
    },
    [],
  );

  const suggestionCtaName = useMemo(() => {
    const explicitFirstName = userFirstName?.trim();
    if (explicitFirstName) return explicitFirstName;

    const localPart = userEmail?.split("@")[0]?.trim();
    if (!localPart) return null;

    const normalized = localPart.replace(/[._-]+/g, " ").trim();
    if (!normalized) return null;
    return normalized
      .split(" ")
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ");
  }, [userFirstName, userEmail]);

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
          history: chatMessages.map(({ role, content }) => ({ role, content })),
          currentForm: {
            description: form.description,
            referenceDomain: form.referenceDomain,
            industry: form.industry,
            tone: form.tone,
            nameStyle: form.nameStyle,
            wordConstraint: form.wordConstraint,
            syllableConstraint: form.syllableConstraint,
            wordTypeConstraint: form.wordTypeConstraint,
            maxLength: form.maxLength,
            maxSyllables: form.maxSyllables,
            avoidDictionaryWords: form.avoidDictionaryWords,
            avoidWords: form.avoidWords,
            tlds: form.tlds,
            temperature: form.temperature,
            count: form.count,
            includePrefixVariants: form.includePrefixVariants,
            minPremiumTarget: form.minPremiumTarget,
            requireAllTlds: form.requireAllTlds,
          },
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Chat failed.");
      }
      const payload = (await response.json()) as {
        reply: string;
        suggestion?: ChatSuggestion | null;
      };
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: payload.reply,
          suggestion: payload.suggestion ?? null,
        },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Chat failed.";
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const applyChatSuggestion = useCallback(
    (suggestion: ChatSuggestion, options: { run?: boolean } = {}): void => {
      const merged = mergeFormWithSuggestion(form, suggestion);
      setForm(merged);
      if (options.run) {
        void submit(false, merged);
      }
    },
    // `submit` is declared below; safe because it's stable via closure access.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form],
  );

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

  const submit = async (refine: boolean, formOverride?: FormState): Promise<void> => {
    const formToUse = formOverride ?? form;
    const startedAt = Date.now();
    setError(null);
    setProgressLog([]);
    setRunTiming({
      startedAt,
      baseEstimateMs: estimateInitialDurationMs(formToUse, refine),
    });
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
          description: formToUse.description,
          referenceDomain: formToUse.referenceDomain.trim() || undefined,
          industry: formToUse.industry || undefined,
          tone: formToUse.tone.length > 0 ? formToUse.tone : undefined,
          nameStyle: formToUse.nameStyle.length > 0 ? formToUse.nameStyle : undefined,
          wordConstraint: formToUse.wordConstraint,
          syllableConstraint: formToUse.syllableConstraint,
          wordTypeConstraint: formToUse.wordTypeConstraint,
          maxLength: formToUse.maxLength,
          maxSyllables: formToUse.maxSyllables,
          avoidDictionaryWords: formToUse.avoidDictionaryWords,
          avoidWords: formToUse.avoidWords
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          tlds: formToUse.tlds,
          temperature: formToUse.temperature,
          count: formToUse.count,
          includePrefixVariants: formToUse.includePrefixVariants,
          minPremiumTarget: formToUse.minPremiumTarget,
          requireAllTlds: formToUse.requireAllTlds,
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
                queueMicrotask(() => {
                  resultsSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                });
                const availableInRun = data.result.names.reduce(
                  (acc, candidate) =>
                    acc + candidate.domains.filter((domain) => domain.available).length,
                  0,
                );
                const historyPayload = {
                  query: formToUse.description.trim(),
                  tone: JSON.stringify(formToUse.tone),
                  nameStyle: JSON.stringify(formToUse.nameStyle),
                  tlds: [...formToUse.tlds],
                  refined: refine,
                  resultCount: data.result.names.length,
                  availableCount: availableInRun,
                  names: data.result.names,
                  meta: data.result.meta,
                };

                if (!isAuthenticated) {
                  const localEntry: SearchHistoryEntry = {
                    ...historyPayload,
                    id: `temp-${crypto.randomUUID()}`,
                    createdAt: new Date().toISOString(),
                  };
                  setSearchHistory((prev) => [localEntry, ...prev].slice(0, 25));
                  setSelectedHistoryId(localEntry.id);
                } else {
                  try {
                    const historyEntry = await createSearchHistoryEntry(historyPayload);
                    setSearchHistory((prev) => [historyEntry, ...prev].slice(0, 25));
                    setSelectedHistoryId(historyEntry.id);
                  } catch (historyError) {
                    if (isAuthRequiredError(historyError)) {
                      setIsAuthenticated(false);
                      setUserEmail(null);
                      setUserFirstName(null);
                    } else {
                      const message =
                        historyError instanceof Error
                          ? historyError.message
                          : "Unable to persist search history.";
                      setSavingStateError(message);
                    }
                  }
                }
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
      setRunTiming(null);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row">
      {/* Left nav: saved names + search */}
      <aside className="hidden md:flex md:w-64 md:shrink-0 md:flex-col border-r border-border bg-card/50">
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </div>
              <span className="font-semibold text-foreground">Naming Lab</span>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={handleSignOut}
              >
                {isAuthenticated ? "Sign out" : "Sign in"}
              </Button>
            </div>
          </div>
          {userEmail ? (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              Signed in as {userEmail}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Browse freely. Sign in when you want to save.
            </p>
          )}
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
        <div className="border-t border-border p-2">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <p className="text-xs text-muted-foreground">Search history</p>
            {searchHistory.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleClearHistory}
              >
                Clear
              </Button>
            ) : null}
          </div>
          {searchHistory.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No previous searches yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {searchHistory.map((entry) => (
                <li key={entry.id}>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant={selectedHistoryId === entry.id ? "secondary" : "ghost"}
                      className="min-w-0 flex-1 justify-start px-2"
                      onClick={() => handleRestoreHistory(entry)}
                    >
                      <div className="min-w-0 text-left">
                        <p className="truncate text-xs font-medium">
                          {historyQueryLabel(entry.query)}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {entry.resultCount} names, {entry.availableCount} available
                        </p>
                      </div>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => handleRemoveHistory(entry.id)}
                      title="Remove history item"
                      aria-label="Remove history item"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border p-3">
          <p className="text-sm font-semibold text-foreground">
            {suggestionCtaName ? `Hi ${suggestionCtaName} - got feedback?` : "Got feedback?"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Share one idea or pain point. We read every note and use it to improve the product.
          </p>
          {feedbackAcknowledgements[0] ? (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50/70 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-xs text-emerald-900 dark:text-emerald-200">
                Thanks - we fixed an issue based on your feedback.
              </p>
              <p className="mt-1 truncate text-xs text-emerald-800 dark:text-emerald-300">
                &quot;{feedbackAcknowledgements[0].title}&quot;
              </p>
              <div className="mt-1 flex items-center gap-2">
                {feedbackAcknowledgements[0].linearIssueUrl &&
                feedbackAcknowledgements[0].linearIssueIdentifier ? (
                  <a
                    href={feedbackAcknowledgements[0].linearIssueUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-emerald-700 underline underline-offset-2 dark:text-emerald-300"
                  >
                    {feedbackAcknowledgements[0].linearIssueIdentifier}
                  </a>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                  onClick={() =>
                    handleDismissFeedbackAcknowledgement(feedbackAcknowledgements[0].id)
                  }
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}
          <Input
            value={suggestionTitle}
            onChange={(event) => setSuggestionTitle(event.target.value)}
            placeholder="Short title"
            className="mt-2 h-8 text-xs"
            maxLength={120}
          />
          <Textarea
            value={suggestionDescription}
            onChange={(event) => setSuggestionDescription(event.target.value)}
            placeholder="What should we improve?"
            className="mt-2 min-h-[84px] text-xs"
            maxLength={4000}
          />
          <Button
            type="button"
            size="sm"
            className="mt-2 w-full"
            disabled={
              suggestionSubmitting ||
              !suggestionTitle.trim() ||
              !suggestionDescription.trim()
            }
            onClick={handleSubmitSuggestion}
          >
            {suggestionSubmitting ? "Sending..." : "Send feedback"}
          </Button>
          {suggestionError ? (
            <p className="mt-2 text-xs text-destructive">{suggestionError}</p>
          ) : null}
          {suggestionIssue ? (
            <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
              Thanks - your feedback has been sent.
            </p>
          ) : null}
          {feedbackImpactError ? (
            <p className="mt-2 text-xs text-destructive">{feedbackImpactError}</p>
          ) : null}
          {feedbackImpactHistory.length > 0 ? (
            <div className="mt-3 border-t border-border pt-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Your feedback helped improve the product
              </p>
              <ul className="mt-1 space-y-1">
                {feedbackImpactHistory.slice(0, 3).map((item) => (
                  <li key={item.id} className="text-[11px] text-muted-foreground">
                    {item.issueStatus === "fixed" ? "Fixed" : "Closed"}:{" "}
                    <span className="text-foreground">{item.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Mobile tab bar — visible only on small screens */}
      <div className="sticky top-0 z-20 flex shrink-0 border-b border-border bg-background md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("form")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${mobileTab === "form" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
        >
          Generator
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("results")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${mobileTab === "results" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
        >
          Results
          {results.length > 0 ? (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-xs text-primary">
              {results.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* Form panel */}
      <div className={`flex-col border-r border-border overflow-y-auto flex-1 md:flex-none md:w-[400px] md:shrink-0 ${mobileTab === "form" ? "flex" : "hidden"} md:flex`}>
        <div className="sticky top-0 z-10 hidden border-b border-border bg-card/95 backdrop-blur-sm px-4 py-3 md:block">
          <h2 className="font-semibold text-foreground">Name generator</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Describe your product, get domain-ready brand names.</p>
        </div>
        <div className="flex flex-col gap-4 p-4">
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
                      ? "premium"
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
              <p className="text-xs text-muted-foreground">
                Score: {selectedSaved.score}
                {selectedSaved.scoreBreakdown ? ` (${scoreBreakdownLabel(selectedSaved)})` : ""}
                {" · "}
                Saved {new Date(selectedSaved.savedAt).toLocaleString()}
              </p>
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
            <div className="mt-6 flex flex-col gap-4">
              <BubbleSelect
                label="Feeling:"
                title="What should someone feel when they hear the name? Pick one or more — hover each chip for a definition."
                options={VIBE_OPTIONS}
                value={form.tone}
                onChange={(value) => setForm((prev) => ({ ...prev, tone: value }))}
                minSelection={1}
              />
              <BubbleSelect
                label="Archetype:"
                title="Lunour naming archetypes — pick one or more to weight the batch. Hover each chip for examples."
                options={NAME_TYPE_OPTIONS}
                value={form.nameStyle}
                onChange={(value) => setForm((prev) => ({ ...prev, nameStyle: value }))}
                minSelection={1}
              />
              <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => (loading && !isRefining ? stopGenerating() : submit(false))}
                disabled={!loading && (!form.description.trim() || form.tlds.length === 0)}
                className="gap-2 border-2 border-primary-foreground/45 shadow-sm"
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
          </div>

          {loading ? (
            <div className="border-t border-border px-6 py-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Activity</p>
                {eta ? (
                  <p className="text-xs text-muted-foreground">
                    Est. remaining: {eta.remainingLabel} ({Math.round(eta.progressRatio * 100)}% complete, {eta.elapsedLabel} elapsed)
                  </p>
                ) : null}
              </div>
              <div
                ref={activityLogRef}
                className="activity-log max-h-40 overflow-y-auto overflow-x-hidden font-mono text-sm"
              >
                {progressLog.length === 0 ? (
                  <div className="py-0.5 text-muted-foreground">Preparing…</div>
                ) : (
                  progressLog.map((msg, i) => {
                    const isActive = i === progressLog.length - 1;
                    return (
                      <div
                        key={i}
                        className={`py-0.5 ${isActive ? "text-chart-1 font-medium animate-pulse" : "text-muted-foreground"}`}
                      >
                        {isActive ? "▸ " : ""}{msg}
                      </div>
                    );
                  })
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
            <Label>Word constraint</Label>
            <Select
              value={form.wordConstraint}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  wordConstraint: (value as FormState["wordConstraint"]) ?? prev.wordConstraint,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Word constraint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oneWord">1-word</SelectItem>
                <SelectItem value="twoWord">2-word</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Syllable constraint</Label>
            <Select
              value={form.syllableConstraint}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  syllableConstraint:
                    (value as FormState["syllableConstraint"]) ?? prev.syllableConstraint,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Syllable constraint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="two">Exactly 2 syllables</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Word type</Label>
            <Select
              value={form.wordTypeConstraint}
              onValueChange={(value) => {
                const next = (value as FormState["wordTypeConstraint"]) ?? form.wordTypeConstraint;
                setForm((prev) => ({
                  ...prev,
                  wordTypeConstraint: next,
                  avoidDictionaryWords: next === "invented",
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Word type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invented">Invented only (no dictionary words)</SelectItem>
                <SelectItem value="mixed">Mixed (invented + dictionary-inspired OK)</SelectItem>
                <SelectItem value="dictionary">Dictionary words only (real English words)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Invented = coined names; Mixed = either; Dictionary = real recognizable words only.</p>
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
          {savingStateError ? (
            <div className="border-t border-border px-6 py-4">
              <p className="text-sm text-destructive">{savingStateError}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
        </div>
      </div>

      {/* Results panel */}
      <main className={`flex-col min-w-0 flex-1 overflow-y-auto ${mobileTab === "results" ? "flex" : "hidden"} md:flex`}>
        <div className="flex flex-col gap-6 p-6">
      <div ref={resultsSectionRef}>
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
        {results.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap gap-2">
              <Input
                type="search"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder='Ask or steer (e.g. "which sounds like Lume?", "avoid words like cloud and data", "no dictionary words")'
                disabled={chatLoading}
                className="min-w-[240px] flex-1"
                aria-label="Ask about generated results"
              />
              <Button
                type="button"
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
              >
                {chatLoading ? "Searching..." : "Ask"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Searches all generated names and domain statuses for this run. Use phrases like
              {" "}
              <span className="text-foreground">&quot;avoid X&quot;</span>,{" "}
              <span className="text-foreground">&quot;no dictionary words&quot;</span>, or{" "}
              <span className="text-foreground">&quot;don&apos;t want anything like vello&quot;</span>{" "}
              and the next run will honor it.
            </p>
            {avoidWordList.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-900 dark:bg-amber-950/20">
                <span className="text-xs font-medium uppercase tracking-wider text-amber-900 dark:text-amber-200">
                  Avoiding
                </span>
                {avoidWordList.map((word) => (
                  <span
                    key={word}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-background px-2 py-0.5 font-mono text-xs text-foreground dark:border-amber-800"
                  >
                    {word}
                    <button
                      type="button"
                      onClick={() => removeAvoidWord(word)}
                      aria-label={`Remove ${word} from avoid list`}
                      title={`Stop avoiding "${word}"`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={clearAvoidWords}
                >
                  Clear all
                </Button>
              </div>
            ) : null}
            {(chatMessages.length > 0 || chatLoading) ? (
              <div className="mt-3 flex max-h-[360px] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-background/80 p-3">
                {chatMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex flex-col gap-2 ${
                      m.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-background text-foreground"
                      }`}
                    >
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    </div>
                    {m.role === "assistant" && m.suggestion ? (
                      (() => {
                        const suggestion = m.suggestion;
                        const deltas = summarizeSuggestion(suggestion);
                        return (
                          <div className="flex w-full max-w-[85%] flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3">
                            <p className="text-xs text-muted-foreground">
                              Suggested next step:{" "}
                              <span className="text-foreground">{suggestion.label}</span>
                            </p>
                            {suggestion.description ? (
                              <p className="text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">New prompt:</span>{" "}
                                {suggestion.description}
                              </p>
                            ) : null}
                            {deltas.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {deltas.map((delta) => (
                                  <Badge
                                    key={`${delta.label}-${delta.value}`}
                                    variant={delta.label === "Avoid" ? "outline" : "secondary"}
                                    className={
                                      delta.label === "Avoid"
                                        ? "border-amber-300/80 text-amber-900 dark:border-amber-800 dark:text-amber-200"
                                        : undefined
                                    }
                                  >
                                    <span className="mr-1 text-[10px] uppercase tracking-wider opacity-70">
                                      {delta.label}
                                    </span>
                                    {delta.value}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  applyChatSuggestion(suggestion, { run: false })
                                }
                                disabled={loading}
                                title="Pre-fill the search form with these settings"
                              >
                                Apply
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  applyChatSuggestion(suggestion, { run: true })
                                }
                                disabled={loading}
                                className="gap-1"
                                title="Pre-fill the form and start a new generation"
                              >
                                <Sparkles className="size-3.5" />
                                Apply &amp; generate
                              </Button>
                            </div>
                          </div>
                        );
                      })()
                    ) : null}
                  </div>
                ))}
                {chatLoading ? (
                  <p className="text-sm text-muted-foreground">Thinking...</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {meta?.domainLookupError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-medium text-destructive">Domain lookup service unavailable</p>
            <p className="mt-2 text-foreground">{meta.domainLookupError}</p>
            <p className="mt-2 text-muted-foreground">
              Suggested names are still listed below, but availability could not be verified—do not rely on
              these checks until the service responds normally.
            </p>
          </div>
        ) : null}

        {meta &&
        meta.generatedCount > 0 &&
        results.length === 0 &&
        !meta.relaxedTldFilter &&
        !meta.domainLookupError ? (
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
                                ? "premium"
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
                  <th className="px-4 py-3 font-medium text-foreground">
                    <span className="inline-flex items-center gap-1">
                      Score
                      <span
                        title="Hover a score cell for ranking rationale."
                        aria-label="Hover a score cell for ranking rationale"
                      >
                        <CircleHelp className="size-3.5 text-muted-foreground" aria-hidden />
                      </span>
                    </span>
                  </th>
                  <th className="w-12 px-4 py-3" aria-label="Save" />
                </tr>
              </thead>
              <tbody>
                {results.map((candidate, idx) => (
                  <tr key={`${candidate.base}-${idx}`} className="border-b border-border/60 align-top transition-colors hover:bg-muted/30">
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
                              ? "premium"
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
                    <td
                      className="px-4 py-3 text-foreground"
                      title={scoreTooltip(candidate, form.nameStyle)}
                    >
                      <div className="inline-flex items-center gap-1 font-medium">
                        {candidate.score}
                        <CircleHelp
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                      {candidate.scoreBreakdown ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {scoreBreakdownLabel(candidate)}
                        </div>
                      ) : null}
                    </td>
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
      </div>
        </div>
      </main>
    </div>
  );
}
