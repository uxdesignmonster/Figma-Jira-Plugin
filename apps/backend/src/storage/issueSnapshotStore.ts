import type { JiraTicketSummary } from "@figma-jira/shared-types";

/**
 * Backend's last-known view of a Jira issue. Populated on refresh or webhook
 * ingest. Used to detect "did anything change since we last looked?" without
 * re-fetching, and to have a fallback summary for widgets whose installation
 * lost Jira access.
 */
export type IssueSnapshot = {
  issueId: string;
  issueKey: string;
  ticket: JiraTicketSummary;
  payloadHash: string;
  fetchedAt: number;
};

export interface IssueSnapshotStore {
  save(snapshot: IssueSnapshot): Promise<void>;
  getByIssueId(issueId: string): Promise<IssueSnapshot | null>;
  getByIssueKey(issueKey: string): Promise<IssueSnapshot | null>;
}

export class InMemoryIssueSnapshotStore implements IssueSnapshotStore {
  private readonly byId = new Map<string, IssueSnapshot>();
  private readonly byKey = new Map<string, IssueSnapshot>();

  async save(snapshot: IssueSnapshot): Promise<void> {
    this.byId.set(snapshot.issueId, snapshot);
    this.byKey.set(snapshot.issueKey, snapshot);
  }

  async getByIssueId(issueId: string): Promise<IssueSnapshot | null> {
    return this.byId.get(issueId) ?? null;
  }

  async getByIssueKey(issueKey: string): Promise<IssueSnapshot | null> {
    return this.byKey.get(issueKey) ?? null;
  }
}
