import type { JiraTicketSummary } from "@figma-jira/shared-types";
import type { DbPool } from "../db/pool.js";
import type {
  IssueSnapshot,
  IssueSnapshotStore,
} from "./issueSnapshotStore.js";

type Row = {
  issue_id: string;
  issue_key: string;
  ticket: JiraTicketSummary;
  payload_hash: string;
  fetched_at: string;
};

function rowToSnapshot(row: Row): IssueSnapshot {
  return {
    issueId: row.issue_id,
    issueKey: row.issue_key,
    ticket: row.ticket,
    payloadHash: row.payload_hash,
    fetchedAt: Number(row.fetched_at),
  };
}

export class PostgresIssueSnapshotStore implements IssueSnapshotStore {
  constructor(private readonly pool: DbPool) {}

  async save(snapshot: IssueSnapshot): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO issue_snapshots
        (issue_id, issue_key, ticket, payload_hash, fetched_at)
      VALUES ($1, $2, $3::jsonb, $4, $5)
      ON CONFLICT (issue_id) DO UPDATE SET
        issue_key    = EXCLUDED.issue_key,
        ticket       = EXCLUDED.ticket,
        payload_hash = EXCLUDED.payload_hash,
        fetched_at   = EXCLUDED.fetched_at
      `,
      [
        snapshot.issueId,
        snapshot.issueKey,
        JSON.stringify(snapshot.ticket),
        snapshot.payloadHash,
        snapshot.fetchedAt,
      ],
    );
  }

  async getByIssueId(issueId: string): Promise<IssueSnapshot | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT issue_id, issue_key, ticket, payload_hash, fetched_at
       FROM issue_snapshots WHERE issue_id = $1`,
      [issueId],
    );
    const row = rows[0];
    return row ? rowToSnapshot(row) : null;
  }

  async getByIssueKey(issueKey: string): Promise<IssueSnapshot | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT issue_id, issue_key, ticket, payload_hash, fetched_at
       FROM issue_snapshots WHERE issue_key = $1
       ORDER BY fetched_at DESC LIMIT 1`,
      [issueKey],
    );
    const row = rows[0];
    return row ? rowToSnapshot(row) : null;
  }
}
