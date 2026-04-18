import { NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface FeedbackRow {
  id: string;
  title: string;
  submitted_at: string;
  issue_status: "fixed" | "closed_no_fix" | "linked" | "submitted" | "unlinked";
  linear_issue_identifier: string | null;
  linear_issue_url: string | null;
  fixed_at: string | null;
  acknowledged_at: string | null;
}

interface DismissBody {
  feedbackId?: string;
}

function toItem(row: FeedbackRow): {
  id: string;
  title: string;
  submittedAt: string;
  issueStatus: "fixed" | "closed_no_fix";
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
  fixedAt?: string;
} {
  return {
    id: row.id,
    title: row.title,
    submittedAt: row.submitted_at,
    issueStatus: row.issue_status as "fixed" | "closed_no_fix",
    linearIssueIdentifier: row.linear_issue_identifier ?? undefined,
    linearIssueUrl: row.linear_issue_url ?? undefined,
    fixedAt: row.fixed_at ?? undefined,
  };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("feedback_submissions")
    .select(
      "id, title, submitted_at, issue_status, linear_issue_identifier, linear_issue_url, fixed_at, acknowledged_at",
    )
    .eq("user_id", auth.userId)
    .in("issue_status", ["fixed", "closed_no_fix"])
    .order("fixed_at", { ascending: false, nullsFirst: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as FeedbackRow[];
  const activeAcknowledgements = rows
    .filter((row) => row.issue_status === "fixed" && !row.acknowledged_at)
    .slice(0, 2)
    .map(toItem);
  const history = rows.slice(0, 6).map(toItem);

  return NextResponse.json({ activeAcknowledgements, history });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json()) as DismissBody;
  const feedbackId = body.feedbackId?.trim();
  if (!feedbackId) {
    return NextResponse.json({ error: "feedbackId is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("feedback_submissions")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", feedbackId)
    .eq("user_id", auth.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
