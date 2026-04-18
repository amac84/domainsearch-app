import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { getLinearIssueStatus } from "@/lib/linear";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type LinearWebhookPayload = {
  action?: string;
  webhookTimestamp?: number;
  data?: {
    id?: string;
    issue?: {
      id?: string;
    };
  };
};

function hasValidSignature(params: {
  rawBody: string;
  headerSignature: string | null;
  signingSecret: string;
}): boolean {
  if (!params.headerSignature) return false;
  if (!/^[0-9a-fA-F]+$/.test(params.headerSignature)) return false;

  const received = Buffer.from(params.headerSignature, "hex");
  const computed = crypto
    .createHmac("sha256", params.signingSecret)
    .update(params.rawBody)
    .digest();

  if (received.length !== computed.length) return false;
  return crypto.timingSafeEqual(computed, received);
}

function hasFreshTimestamp(payload: LinearWebhookPayload): boolean {
  const nowMs = Date.now();
  const webhookTimestamp = Number(payload.webhookTimestamp ?? Number.NaN);
  if (!Number.isFinite(webhookTimestamp)) return false;
  const driftMs = Math.abs(nowMs - webhookTimestamp);
  return driftMs <= 5 * 60 * 1000;
}

function getIssueId(payload: LinearWebhookPayload): string | null {
  const fromData = payload.data?.id?.trim();
  if (fromData) return fromData;
  const fromNestedIssue = payload.data?.issue?.id?.trim();
  if (fromNestedIssue) return fromNestedIssue;
  return null;
}

function toLocalIssueStatus(stateType: string | null, completedAt: string | null): {
  issueStatus: "fixed" | "closed_no_fix" | "linked";
  fixedAt: string | null;
} {
  const normalized = (stateType ?? "").toLowerCase();
  if (normalized === "completed" || completedAt) {
    return { issueStatus: "fixed", fixedAt: completedAt ?? new Date().toISOString() };
  }
  if (normalized === "canceled") {
    return { issueStatus: "closed_no_fix", fixedAt: null };
  }
  return { issueStatus: "linked", fixedAt: null };
}

export async function POST(request: Request): Promise<NextResponse> {
  const signingSecret = process.env.LINEAR_WEBHOOK_SECRET?.trim();
  if (!signingSecret) {
    return NextResponse.json(
      { error: "Missing LINEAR_WEBHOOK_SECRET for webhook verification." },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const headerSignature = request.headers.get("linear-signature");
  if (!hasValidSignature({ rawBody, headerSignature, signingSecret })) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  if (!hasFreshTimestamp(payload)) {
    return NextResponse.json({ error: "Stale webhook timestamp." }, { status: 401 });
  }

  const apiKey = process.env.LINEAR_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing LINEAR_API_KEY for webhook processing." },
      { status: 500 },
    );
  }

  const issueId = getIssueId(payload);
  if (!issueId) {
    return NextResponse.json({ ok: true, ignored: "no_issue_id" });
  }

  try {
    const issue = await getLinearIssueStatus(apiKey, issueId);
    if (!issue) {
      return NextResponse.json({ ok: true, ignored: "issue_not_found" });
    }

    const status = toLocalIssueStatus(issue.stateType, issue.completedAt);
    const supabaseAdmin = createSupabaseAdminClient();
    const { error } = await supabaseAdmin
      .from("feedback_submissions")
      .update({
        linear_issue_identifier: issue.identifier,
        linear_issue_url: issue.url,
        linear_issue_state_name: issue.stateName,
        linear_issue_state_type: issue.stateType,
        issue_status: status.issueStatus,
        fixed_at: status.fixedAt,
      })
      .eq("linear_issue_id", issue.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process Linear webhook.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
