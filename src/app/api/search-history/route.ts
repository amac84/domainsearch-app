import { NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GenerateMeta, NameCandidate, SearchHistoryEntry } from "@/types";

const MAX_HISTORY_ITEMS = 25;

interface SearchHistoryRow {
  id: string;
  created_at: string;
  query: string;
  tone: string;
  name_style: string;
  tlds: string[];
  refined: boolean;
  result_count: number;
  available_count: number;
  names: NameCandidate[];
  meta: GenerateMeta;
}

interface SearchHistoryInput {
  query: string;
  tone: string;
  nameStyle: string;
  tlds: string[];
  refined: boolean;
  resultCount: number;
  availableCount: number;
  names: NameCandidate[];
  meta: GenerateMeta;
}

interface AddHistoryBody {
  item?: SearchHistoryInput;
}

function toHistoryEntry(row: SearchHistoryRow): SearchHistoryEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    query: row.query,
    tone: row.tone,
    nameStyle: row.name_style,
    tlds: row.tlds,
    refined: row.refined,
    resultCount: row.result_count,
    availableCount: row.available_count,
    names: row.names,
    meta: row.meta,
  };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("search_history")
    .select(
      "id, created_at, query, tone, name_style, tlds, refined, result_count, available_count, names, meta",
    )
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_ITEMS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []).map((row) => toHistoryEntry(row as SearchHistoryRow)) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json()) as AddHistoryBody;
  if (!body.item) {
    return NextResponse.json({ error: "item is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error: insertError } = await supabase
    .from("search_history")
    .insert({
      user_id: auth.userId,
      query: body.item.query,
      tone: body.item.tone,
      name_style: body.item.nameStyle,
      tlds: body.item.tlds,
      refined: body.item.refined,
      result_count: body.item.resultCount,
      available_count: body.item.availableCount,
      names: body.item.names,
      meta: body.item.meta,
    })
    .select(
      "id, created_at, query, tone, name_style, tlds, refined, result_count, available_count, names, meta",
    )
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data: allRows, error: allError } = await supabase
    .from("search_history")
    .select("id")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (allError) {
    return NextResponse.json({ error: allError.message }, { status: 500 });
  }

  const staleIds = (allRows ?? []).slice(MAX_HISTORY_ITEMS).map((row) => row.id);
  if (staleIds.length > 0) {
    await supabase
      .from("search_history")
      .delete()
      .eq("user_id", auth.userId)
      .in("id", staleIds);
  }

  return NextResponse.json({ item: toHistoryEntry(inserted as SearchHistoryRow) });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const requestUrl = new URL(request.url);
  const clearAll = requestUrl.searchParams.get("all") === "1";
  const id = requestUrl.searchParams.get("id");
  const supabase = await createSupabaseServerClient();

  if (clearAll) {
    const { error } = await supabase.from("search_history").delete().eq("user_id", auth.userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!id) {
    return NextResponse.json({ error: "id is required when all is not set." }, { status: 400 });
  }

  const { error } = await supabase
    .from("search_history")
    .delete()
    .eq("user_id", auth.userId)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
