const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearError {
  message: string;
}

export interface LinearIssueRef {
  id: string;
  identifier: string;
  url: string;
}

export interface LinearIssueStatus extends LinearIssueRef {
  stateName: string | null;
  stateType: string | null;
  completedAt: string | null;
}

interface LinearProjectResponse {
  project: {
    id: string;
    team: {
      id: string;
    } | null;
  } | null;
}

interface LinearIssueCreateResponse {
  issueCreate: {
    success: boolean;
    issue: LinearIssueRef | null;
  };
}

interface LinearIssueByIdResponse {
  issue: {
    id: string;
    identifier: string;
    url: string;
    completedAt: string | null;
    state: {
      id: string;
      name: string;
      type: string;
    } | null;
  } | null;
}

async function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    data?: T;
    errors?: LinearError[];
  };

  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.message ?? "Linear request failed.");
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? "Linear request failed.");
  }

  if (!payload.data) {
    throw new Error("Linear request returned no data.");
  }

  return payload.data;
}

export async function resolveLinearTeamId(
  apiKey: string,
  projectId: string,
): Promise<string> {
  const projectData = await linearRequest<LinearProjectResponse>(
    apiKey,
    `
      query SuggestionProject($projectId: String!) {
        project(id: $projectId) {
          id
          team {
            id
          }
        }
      }
    `,
    { projectId },
  );

  const teamId = projectData.project?.team?.id;
  if (!teamId) {
    throw new Error("Could not resolve Linear team from LINEAR_PROJECT_ID.");
  }
  return teamId;
}

export async function createLinearIssue(params: {
  apiKey: string;
  projectId: string;
  teamId: string;
  title: string;
  description: string;
  stateId?: string;
  labelIds?: string[];
}): Promise<LinearIssueRef> {
  const issueData = await linearRequest<LinearIssueCreateResponse>(
    params.apiKey,
    `
      mutation CreateSuggestion($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            url
          }
        }
      }
    `,
    {
      input: {
        teamId: params.teamId,
        projectId: params.projectId,
        stateId: params.stateId || undefined,
        labelIds: params.labelIds?.length ? params.labelIds : undefined,
        title: params.title,
        description: params.description,
      },
    },
  );

  if (!issueData.issueCreate.success || !issueData.issueCreate.issue) {
    throw new Error("Linear did not create the issue.");
  }

  return issueData.issueCreate.issue;
}

export async function getLinearIssueStatus(
  apiKey: string,
  issueId: string,
): Promise<LinearIssueStatus | null> {
  const issueData = await linearRequest<LinearIssueByIdResponse>(
    apiKey,
    `
      query FeedbackIssue($issueId: String!) {
        issue(id: $issueId) {
          id
          identifier
          url
          completedAt
          state {
            id
            name
            type
          }
        }
      }
    `,
    { issueId },
  );

  const issue = issueData.issue;
  if (!issue) return null;

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    stateName: issue.state?.name ?? null,
    stateType: issue.state?.type ?? null,
    completedAt: issue.completedAt,
  };
}
