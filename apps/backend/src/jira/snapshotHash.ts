import { createHash } from "node:crypto";
import type { JiraTicketSummary } from "@figma-jira/shared-types";

/**
 * Stable hash over the fields a user sees in the widget card. Used to detect
 * "did anything actually change?" when the Jira issue `updated` timestamp
 * bumped but the rendered output is the same (e.g. a field we don't display
 * was touched).
 */
export function hashTicket(t: JiraTicketSummary): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        t.summary,
        t.status,
        t.assigneeName ?? "",
        t.updatedAt,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}
