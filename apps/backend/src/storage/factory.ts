import type { AppConfig } from "../config.js";
import { InMemoryTokenStore, type TokenStore } from "./tokenStore.js";
import {
  InMemoryWidgetLinkStore,
  type WidgetLinkStore,
} from "./widgetLinkStore.js";
import {
  InMemoryIssueSnapshotStore,
  type IssueSnapshotStore,
} from "./issueSnapshotStore.js";
import { PostgresTokenStore } from "./postgresTokenStore.js";
import { PostgresWidgetLinkStore } from "./postgresWidgetLinkStore.js";
import { PostgresIssueSnapshotStore } from "./postgresIssueSnapshotStore.js";
import { createPool, type DbPool } from "../db/pool.js";

export type Stores = {
  tokens: TokenStore;
  links: WidgetLinkStore;
  snapshots: IssueSnapshotStore;
  pool: DbPool | null;
};

/**
 * Build the durable stores for this process. When `DATABASE_URL` is set, we
 * use the Postgres-backed implementations and return the pool so index.ts
 * can close it on shutdown. When unset, we fall back to in-memory stores
 * (`config.ts` already blocked this for production).
 */
export function buildStores(config: AppConfig): Stores {
  if (config.database.url) {
    const pool = createPool(config.database.url);
    return {
      tokens: new PostgresTokenStore(pool),
      links: new PostgresWidgetLinkStore(pool),
      snapshots: new PostgresIssueSnapshotStore(pool),
      pool,
    };
  }
  return {
    tokens: new InMemoryTokenStore(),
    links: new InMemoryWidgetLinkStore(),
    snapshots: new InMemoryIssueSnapshotStore(),
    pool: null,
  };
}
