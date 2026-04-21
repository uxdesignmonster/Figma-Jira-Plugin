export type JiraTicketSummary = {
  issueId: string;
  issueKey: string;
  url: string;
  summary: string;
  status: string;
  assigneeName: string | null;
  updatedAt: string;
};

export type BackendErrorCode =
  | "unauthenticated"
  | "reauth_required"
  | "not_found"
  | "upstream_error"
  | "bad_request";

export type BackendError = {
  code: BackendErrorCode;
  message: string;
};

export type JiraTicketSearchResult = JiraTicketSummary;

/**
 * Shape of a widget's on-canvas synced state. Keep this narrow and
 * render-focused — the widget is not a second source of truth.
 */
export type WidgetTicketState = {
  ticket: JiraTicketSummary | null;
  lastSyncedAt: string | null;
  isLoading: boolean;
  error: string | null;
};

export type JiraSiteSummary = {
  cloudId: string;
  url: string;
  name: string;
};

export type JiraAccountSummary = {
  accountId: string;
  email?: string;
  displayName?: string;
};

export type ConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      site: JiraSiteSummary;
      account: JiraAccountSummary;
      connectedAt: number;
    };

export type GetIssueResponse =
  | { ok: true; ticket: JiraTicketSummary }
  | { ok: false; error: BackendError };

export type SearchIssuesResponse =
  | { ok: true; tickets: JiraTicketSummary[] }
  | { ok: false; error: BackendError };

// Messages from plugin sandbox (code.ts) → UI iframe.
export type PluginToUiMessage =
  | { type: "init"; installationId: string; backendUrl: string }
  | { type: "insert-widget-result"; ok: true; issueKey: string }
  | { type: "insert-widget-result"; ok: false; error: string };

// Messages from UI iframe → plugin sandbox.
export type UiToPluginMessage =
  | { type: "open-external"; url: string }
  | { type: "insert-widget"; ticket: JiraTicketSummary }
  | { type: "close" };
