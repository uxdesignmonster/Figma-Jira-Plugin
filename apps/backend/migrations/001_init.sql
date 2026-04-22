-- Token store: one Jira connection per installationId.
CREATE TABLE IF NOT EXISTS jira_connections (
  installation_id   TEXT PRIMARY KEY,
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  expires_at        BIGINT NOT NULL,
  site              JSONB NOT NULL,
  account           JSONB NOT NULL,
  connected_at      BIGINT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Widget links: one row per inserted widget instance.
CREATE TABLE IF NOT EXISTS widget_links (
  link_id                     TEXT PRIMARY KEY,
  installation_id             TEXT NOT NULL,
  widget_node_id              TEXT NOT NULL,
  widget_id                   TEXT NOT NULL,
  file_key                    TEXT,
  file_name                   TEXT,
  issue_id                    TEXT NOT NULL,
  issue_key                   TEXT NOT NULL,
  last_synced_at              TEXT NOT NULL,
  last_known_issue_updated_at TEXT NOT NULL,
  is_stale                    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  BIGINT NOT NULL,
  UNIQUE (installation_id, widget_node_id)
);

CREATE INDEX IF NOT EXISTS widget_links_issue_id_idx ON widget_links (issue_id);
CREATE INDEX IF NOT EXISTS widget_links_issue_key_idx ON widget_links (issue_key);

-- Issue snapshots: last-known view per Jira issue.
CREATE TABLE IF NOT EXISTS issue_snapshots (
  issue_id      TEXT PRIMARY KEY,
  issue_key     TEXT NOT NULL,
  ticket        JSONB NOT NULL,
  payload_hash  TEXT NOT NULL,
  fetched_at    BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS issue_snapshots_issue_key_idx ON issue_snapshots (issue_key);
