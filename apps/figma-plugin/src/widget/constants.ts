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
  // Set at insert/register time to whatever `useWidgetNodeId()` returned for
  // the live widget. Clones carry this value forward, so if the runtime node
  // id doesn't match, we know we're looking at a duplicated widget and must
  // re-register against the current node.
  registeredNodeId: "registeredNodeId",
} as const;
