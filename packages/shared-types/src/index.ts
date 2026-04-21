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

export type GetIssueResponse =
  | { ok: true; ticket: JiraTicketSummary }
  | { ok: false; error: BackendError };

export type SearchIssuesResponse =
  | { ok: true; tickets: JiraTicketSummary[] }
  | { ok: false; error: BackendError };

export type PluginToUiMessage =
  | { type: "auth-status"; connected: boolean }
  | { type: "insert-widget-result"; ok: boolean };

export type UiToPluginMessage =
  | { type: "insert-widget"; ticket: JiraTicketSummary }
  | { type: "close" };
