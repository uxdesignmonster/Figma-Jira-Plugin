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
  | "not_found"
  | "upstream_error"
  | "bad_request";

export type BackendError = {
  code: BackendErrorCode;
  message: string;
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
  | { type: "insert-widget-result"; ok: boolean };

// Messages from UI iframe → plugin sandbox.
export type UiToPluginMessage =
  | { type: "open-external"; url: string }
  | { type: "insert-widget"; ticket: JiraTicketSummary }
  | { type: "close" };
