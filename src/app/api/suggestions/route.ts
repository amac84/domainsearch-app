import { NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import {
  createLinearIssue,
  type LinearIssueRef,
  resolveLinearTeamId,
} from "@/lib/linear";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 4000;

interface SuggestionBody {
  title?: string;
  description?: string;
}

interface FeedbackSubmissionRow {
  id: string;
  linear_issue_id: string | null;
  linear_issue_identifier: string | null;
  linear_issue_url: string | null;
  issue_status: string;
}

function parseLabelIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildLinearDescription(params: {
  description: string;
  userId: string;
  userEmail: string | null;
}): string {
  const metadata = [
    "Submitted from Domainsearch Naming Lab",
    `User ID: ${params.userId}`,
    `User email: ${params.userEmail ?? "unknown"}`,
    `Submitted at: ${new Date().toISOString()}`,
  ];

  return `${params.description}\n\n---\n${metadata.join("\n")}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (auth instanceof NextResponse) return auth;

  const apiKey = process.env.LINEAR_API_KEY?.trim();
  const projectId = process.env.LINEAR_PROJECT_ID?.trim();
  const stateId = process.env.LINEAR_SUGGESTION_STATE_ID?.trim();
  const labelIds = parseLabelIds(process.env.LINEAR_SUGGESTION_LABEL_IDS);

  if (!apiKey || !projectId) {
    return NextResponse.json(
      {
        error:
          "Linear is not configured. Set LINEAR_API_KEY and LINEAR_PROJECT_ID.",
      },
      { status: 500 },
    );
  }

  const body = (await request.json()) as SuggestionBody;
  const title = body.title?.trim() ?? "";
  const description = body.description?.trim() ?? "";

  if (!title || !description) {
    return NextResponse.json(
      { error: "title and description are required." },
      { status: 400 },
    );
  }

  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      {
        error: `title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
      },
      { status: 400 },
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      {
        error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
      },
      { status: 400 },
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const normalizedTitle = normalizeTitle(title);

    let issueRef: LinearIssueRef | null = null;

    // Reuse a live issue with the same normalized title so multiple users can
    // be tied to the same Linear issue when they report the same thing.
    const { data: existingRows, error: existingRowsError } = await supabase
      .from("feedback_submissions")
      .select(
        "id, linear_issue_id, linear_issue_identifier, linear_issue_url, issue_status",
      )
      .eq("normalized_title", normalizedTitle)
      .in("issue_status", ["linked", "submitted"])
      .not("linear_issue_id", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(1);

    if (existingRowsError) {
      throw new Error(existingRowsError.message);
    }

    const existing = (existingRows?.[0] ?? null) as FeedbackSubmissionRow | null;
    if (existing?.linear_issue_id) {
      issueRef = {
        id: existing.linear_issue_id,
        identifier: existing.linear_issue_identifier ?? "LINEAR",
        url: existing.linear_issue_url ?? "",
      };
    } else {
      const teamId = await resolveLinearTeamId(apiKey, projectId);
      issueRef = await createLinearIssue({
        apiKey,
        teamId,
        projectId,
        stateId,
        labelIds,
        title,
        description: buildLinearDescription({
          description,
          userId: auth.userId,
          userEmail: user?.email ?? null,
        }),
      });
    }

    if (!issueRef?.id || !issueRef.identifier || !issueRef.url) {
      throw new Error("Unable to link feedback to a Linear issue.");
    }

    const { data: inserted, error: insertError } = await supabase
      .from("feedback_submissions")
      .insert({
        user_id: auth.userId,
        normalized_title: normalizedTitle,
        title,
        description,
        linear_issue_id: issueRef.id,
        linear_issue_identifier: issueRef.identifier,
        linear_issue_url: issueRef.url,
        issue_status: "linked",
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({ feedbackId: inserted.id, issue: issueRef });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to submit suggestion to Linear.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
