import type { DbPool } from "../db/pool.js";
import type {
  JiraConnection,
  TokenStore,
} from "./tokenStore.js";

/**
 * Postgres-backed `TokenStore`. Schema is defined in `migrations/001_init.sql`.
 */
export class PostgresTokenStore implements TokenStore {
  constructor(private readonly pool: DbPool) {}

  async save(conn: JiraConnection): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO jira_connections
        (installation_id, access_token, refresh_token, expires_at,
         site, account, connected_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW())
      ON CONFLICT (installation_id) DO UPDATE SET
        access_token  = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at    = EXCLUDED.expires_at,
        site          = EXCLUDED.site,
        account       = EXCLUDED.account,
        connected_at  = EXCLUDED.connected_at,
        updated_at    = NOW()
      `,
      [
        conn.installationId,
        conn.accessToken,
        conn.refreshToken,
        conn.expiresAt,
        JSON.stringify(conn.site),
        JSON.stringify(conn.account),
        conn.connectedAt,
      ],
    );
  }

  async load(installationId: string): Promise<JiraConnection | null> {
    const { rows } = await this.pool.query<{
      installation_id: string;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      site: JiraConnection["site"];
      account: JiraConnection["account"];
      connected_at: string;
    }>(
      `SELECT installation_id, access_token, refresh_token, expires_at,
              site, account, connected_at
       FROM jira_connections WHERE installation_id = $1`,
      [installationId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      installationId: row.installation_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      // BIGINT columns come back as strings from pg by default.
      expiresAt: Number(row.expires_at),
      site: row.site,
      account: row.account,
      connectedAt: Number(row.connected_at),
    };
  }

  async delete(installationId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM jira_connections WHERE installation_id = $1",
      [installationId],
    );
  }
}
