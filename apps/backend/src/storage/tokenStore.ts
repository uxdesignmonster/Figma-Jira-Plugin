export type JiraSite = {
  cloudId: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl?: string;
};

export type JiraAccount = {
  accountId: string;
  email?: string;
  displayName?: string;
};

export type JiraConnection = {
  installationId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  site: JiraSite;
  account: JiraAccount;
  connectedAt: number;
};

/**
 * Persistence interface for Jira connections.
 *
 * The in-memory implementation below is MVP-only: connections are lost when
 * the process restarts. A Postgres/Supabase implementation can slot in here
 * without changing the routes.
 */
export interface TokenStore {
  save(conn: JiraConnection): Promise<void>;
  load(installationId: string): Promise<JiraConnection | null>;
  delete(installationId: string): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  private readonly store = new Map<string, JiraConnection>();

  async save(conn: JiraConnection): Promise<void> {
    this.store.set(conn.installationId, conn);
  }

  async load(installationId: string): Promise<JiraConnection | null> {
    return this.store.get(installationId) ?? null;
  }

  async delete(installationId: string): Promise<void> {
    this.store.delete(installationId);
  }
}
