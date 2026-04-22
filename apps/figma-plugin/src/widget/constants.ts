// Shared constants between plugin sandbox and widget. Both run in the same
// sandbox when this plugin is invoked, so they can import from the same file.

export const BACKEND_URL = "http://localhost:4000";
export const INSTALLATION_STORAGE_KEY = "figma-jira.installationId";

export const WIDGET_STATE_KEYS = {
  ticket: "ticket",
  lastSyncedAt: "lastSyncedAt",
  isLoading: "isLoading",
  error: "error",
  backendLinkId: "backendLinkId",
  isStale: "isStale",
} as const;
