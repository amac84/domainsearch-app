interface SuggestionIssue {
  id: string;
  identifier: string;
  url: string;
}

interface SuggestionResponse {
  feedbackId?: string;
  issue?: SuggestionIssue;
  error?: string;
}

export interface SuggestionInput {
  title: string;
  description: string;
}

async function parseOrThrow(response: Response): Promise<SuggestionResponse> {
  const payload = (await response.json()) as SuggestionResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Suggestion request failed.");
  }
  return payload;
}

export async function submitSuggestion(input: SuggestionInput): Promise<SuggestionIssue> {
  const response = await fetch("/api/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseOrThrow(response);
  return payload.issue as SuggestionIssue;
}

export interface FeedbackImpactItem {
  id: string;
  title: string;
  submittedAt: string;
  issueStatus: "fixed" | "closed_no_fix";
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
  fixedAt?: string;
}

interface FeedbackImpactResponse {
  activeAcknowledgements?: FeedbackImpactItem[];
  history?: FeedbackImpactItem[];
  error?: string;
}

export async function fetchFeedbackImpact(): Promise<{
  activeAcknowledgements: FeedbackImpactItem[];
  history: FeedbackImpactItem[];
}> {
  const response = await fetch("/api/feedback", { cache: "no-store" });
  const payload = (await response.json()) as FeedbackImpactResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Feedback request failed.");
  }
  return {
    activeAcknowledgements: payload.activeAcknowledgements ?? [],
    history: payload.history ?? [],
  };
}

export async function dismissFeedbackAcknowledgement(feedbackId: string): Promise<void> {
  const response = await fetch("/api/feedback", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedbackId }),
  });
  const payload = (await response.json()) as FeedbackImpactResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to dismiss feedback acknowledgement.");
  }
}
