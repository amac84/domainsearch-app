import { NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DomainResult, NameScoreBreakdown, SavedName } from "@/types";

interface SavedNameRow {
  id: string;
  base: string;
  domains: DomainResult[];
  rationale: string | null;
  score: number;
  score_breakdown: NameScoreBreakdown | null;
  summary_conclusion: string | null;
  recommendation_reason: string | null;
  saved_at: string;
}

interface SavedNameInput {
  base: string;
  domains: DomainResult[];
  rationale?: string;
  score: number;
  scoreBreakdown?: NameScoreBreakdown;
  summaryConclusion?: string;
  recommendationReason?: string;
}

interface SaveNamesBody {
  items?: SavedNameInput[];
}

function toSavedName(row: SavedNameRow): SavedName {
  return {
    id: row.id,
    base: row.base,
    domains: row.domains,
    rationale: row.rationale ?? undefined,
    score: row.score,
    scoreBreakdown: row.score_breakdown ?? undefined,
    summaryConclusion: row.summary_conclusion ?? undefined,
    recommendationReason: row.recommendation_reason ?? undefined,
    savedAt: row.saved_at,
  };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("saved_names")
    .select(
      "id, base, domains, rationale, score, score_breakdown, summary_conclusion, recommendation_reason, saved_at",
    )
    .eq("user_id", auth.userId)
    .order("saved_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []).map((row) => toSavedName(row as SavedNameRow)) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json()) as SaveNamesBody;
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "items must be a non-empty array." }, { status: 400 });
  }

  const payload = items.map((item) => ({
    user_id: auth.userId,
    base: item.base,
    domains: item.domains,
    rationale: item.rationale ?? null,
    score: item.score,
    score_breakdown: item.scoreBreakdown ?? null,
    summary_conclusion: item.summaryConclusion ?? null,
    recommendation_reason: item.recommendationReason ?? null,
  }));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("saved_names")
    .insert(payload)
    .select(
      "id, base, domains, rationale, score, score_breakdown, summary_conclusion, recommendation_reason, saved_at",
    )
    .order("saved_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []).map((row) => toSavedName(row as SavedNameRow)) });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const requestUrl = new URL(request.url);
  const id = requestUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("saved_names")
    .delete()
    .eq("user_id", auth.userId)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
