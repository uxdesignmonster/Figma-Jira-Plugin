import type { JiraTicketSummary } from "@figma-jira/shared-types";

// Minimal shape of a Jira REST v3 issue with the fields we request.
export type JiraIssueResponse = {
  id: string;
  key: string;
  fields?: {
    summary?: string;
    updated?: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
  };
};

export const JIRA_ISSUE_FIELDS = ["summary", "status", "assignee", "updated"];

export function toTicketSummary(
  issue: JiraIssueResponse,
  siteUrl: string,
): JiraTicketSummary {
  const fields = issue.fields ?? {};
  return {
    issueId: issue.id,
    issueKey: issue.key,
    url: `${siteUrl.replace(/\/$/, "")}/browse/${issue.key}`,
    summary: fields.summary ?? "",
    status: fields.status?.name ?? "Unknown",
    assigneeName: fields.assignee?.displayName ?? null,
    updatedAt: fields.updated ?? "",
  };
}
