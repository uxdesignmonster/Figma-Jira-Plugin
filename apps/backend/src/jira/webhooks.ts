import type { JiraTicketSummary } from "@figma-jira/shared-types";
import type { JiraIssueResponse } from "./mapper.js";
import { toTicketSummary } from "./mapper.js";
import type { FreshnessService } from "./freshness.js";
import type { WebhookDedupStore } from "../storage/webhookDedupStore.js";

/**
 * Shape of a Jira Cloud issue webhook body. We only rely on the fields we
 * actually use — the rest is ignored to stay resilient to Atlassian
 * additions.
 */
export type JiraWebhookBody = {
  timestamp?: number;
  webhookEvent?: string;
  issue_event_type_name?: string;
  issue?: JiraIssueResponse & { self?: string };
  // Optional: present when Jira retries, used as dedup key if available.
  id?: string;
};

export type WebhookProcessResult =
  | { status: "accepted"; transitionedLinkIds: string[] }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

type Deps = {
  freshness: FreshnessService;
  dedup: WebhookDedupStore;
};

const HANDLED_EVENTS = new Set([
  "jira:issue_updated",
  "jira:issue_created",
  "jira:issue_deleted",
]);

export class WebhookProcessor {
  constructor(private readonly deps: Deps) {}

  async process(body: JiraWebhookBody): Promise<WebhookProcessResult> {
    const event = body.webhookEvent;
    if (!event || !HANDLED_EVENTS.has(event)) {
      return { status: "ignored", reason: `unhandled event: ${event ?? "none"}` };
    }

    const issue = body.issue;
    if (!issue || !issue.id || !issue.key) {
      return { status: "ignored", reason: "missing issue identity" };
    }

    // Dedup key: prefer Atlassian's own id if present, fall back to a
    // synthetic key so retries still collide. `timestamp` plus issueId is
    // sufficient in practice because Jira doesn't emit two real changes in
    // the same millisecond for the same issue.
    const dedupKey =
      body.id ?? `${issue.id}:${event}:${body.timestamp ?? "0"}`;
    if (!this.deps.dedup.record(dedupKey)) {
      return { status: "duplicate" };
    }

    // Deletion: treat as a change so linked widgets become stale and the
    // user sees a not_found surface on next refresh.
    if (event === "jira:issue_deleted") {
      const tombstone: JiraTicketSummary = {
        issueId: issue.id,
        issueKey: issue.key,
        url: "",
        summary: "(deleted)",
        status: "Deleted",
        assigneeName: null,
        updatedAt: new Date(body.timestamp ?? Date.now()).toISOString(),
      };
      const transitioned = await this.deps.freshness.onIssueChanged(tombstone);
      return { status: "accepted", transitionedLinkIds: transitioned };
    }

    const siteUrl = extractSiteUrl(issue.self);
    const ticket = toTicketSummary(issue, siteUrl);
    const transitioned = await this.deps.freshness.onIssueChanged(ticket);
    return { status: "accepted", transitionedLinkIds: transitioned };
  }
}

/**
 * `issue.self` looks like `https://<tenant>.atlassian.net/rest/api/3/issue/...`.
 * We keep the origin so snapshot URLs stay clickable. If it's absent or
 * unparseable we return an empty string — the link is only used when the
 * widget has no better URL cached.
 */
function extractSiteUrl(self: string | undefined): string {
  if (!self) return "";
  try {
    const u = new URL(self);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}
