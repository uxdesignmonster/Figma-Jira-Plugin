import type { DbPool } from "../db/pool.js";
import type { WidgetLink, WidgetLinkStore } from "./widgetLinkStore.js";

type Row = {
  link_id: string;
  installation_id: string;
  widget_node_id: string;
  widget_id: string;
  file_key: string | null;
  file_name: string | null;
  issue_id: string;
  issue_key: string;
  last_synced_at: string;
  last_known_issue_updated_at: string;
  is_stale: boolean;
  created_at: string;
};

function rowToLink(row: Row): WidgetLink {
  return {
    linkId: row.link_id,
    installationId: row.installation_id,
    widgetNodeId: row.widget_node_id,
    widgetId: row.widget_id,
    fileKey: row.file_key,
    fileName: row.file_name,
    issueId: row.issue_id,
    issueKey: row.issue_key,
    lastSyncedAt: row.last_synced_at,
    lastKnownIssueUpdatedAt: row.last_known_issue_updated_at,
    isStale: row.is_stale,
    createdAt: Number(row.created_at),
  };
}

const SELECT_COLS = `
  link_id, installation_id, widget_node_id, widget_id, file_key, file_name,
  issue_id, issue_key, last_synced_at, last_known_issue_updated_at,
  is_stale, created_at
`;

export class PostgresWidgetLinkStore implements WidgetLinkStore {
  constructor(private readonly pool: DbPool) {}

  async save(link: WidgetLink): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO widget_links
        (link_id, installation_id, widget_node_id, widget_id, file_key, file_name,
         issue_id, issue_key, last_synced_at, last_known_issue_updated_at,
         is_stale, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (link_id) DO UPDATE SET
        installation_id             = EXCLUDED.installation_id,
        widget_node_id              = EXCLUDED.widget_node_id,
        widget_id                   = EXCLUDED.widget_id,
        file_key                    = EXCLUDED.file_key,
        file_name                   = EXCLUDED.file_name,
        issue_id                    = EXCLUDED.issue_id,
        issue_key                   = EXCLUDED.issue_key,
        last_synced_at              = EXCLUDED.last_synced_at,
        last_known_issue_updated_at = EXCLUDED.last_known_issue_updated_at,
        is_stale                    = EXCLUDED.is_stale
      `,
      [
        link.linkId,
        link.installationId,
        link.widgetNodeId,
        link.widgetId,
        link.fileKey,
        link.fileName,
        link.issueId,
        link.issueKey,
        link.lastSyncedAt,
        link.lastKnownIssueUpdatedAt,
        link.isStale,
        link.createdAt,
      ],
    );
  }

  async getById(linkId: string): Promise<WidgetLink | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${SELECT_COLS} FROM widget_links WHERE link_id = $1`,
      [linkId],
    );
    const row = rows[0];
    return row ? rowToLink(row) : null;
  }

  async findByNode(
    installationId: string,
    widgetNodeId: string,
  ): Promise<WidgetLink | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${SELECT_COLS} FROM widget_links
       WHERE installation_id = $1 AND widget_node_id = $2`,
      [installationId, widgetNodeId],
    );
    const row = rows[0];
    return row ? rowToLink(row) : null;
  }

  async listByIssueId(issueId: string): Promise<WidgetLink[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${SELECT_COLS} FROM widget_links WHERE issue_id = $1`,
      [issueId],
    );
    return rows.map(rowToLink);
  }

  async listByIssueKey(issueKey: string): Promise<WidgetLink[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${SELECT_COLS} FROM widget_links WHERE issue_key = $1`,
      [issueKey],
    );
    return rows.map(rowToLink);
  }

  async delete(linkId: string): Promise<void> {
    await this.pool.query("DELETE FROM widget_links WHERE link_id = $1", [
      linkId,
    ]);
  }
}
