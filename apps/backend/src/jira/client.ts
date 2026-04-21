import type { JiraTicketSummary } from "@figma-jira/shared-types";
import type { AppConfig } from "../config.js";
import type { TokenStore, JiraConnection } from "../storage/tokenStore.js";
import {
  AtlassianApiError,
  refreshAccessToken,
} from "../auth/atlassian.js";
import {
  JIRA_ISSUE_FIELDS,
  toTicketSummary,
  type JiraIssueResponse,
} from "./mapper.js";
import {
  NotAuthenticatedError,
  NotFoundError,
  ReauthRequiredError,
  UpstreamError,
} from "./errors.js";

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const EXPIRY_BUFFER_MS = 60_000;
const SEARCH_MAX_RESULTS = 20;

type SearchResponse = {
  issues?: JiraIssueResponse[];
  nextPageToken?: string;
  // older shape support
  total?: number;
};

export class JiraClient {
  constructor(
    private readonly config: AppConfig,
    private readonly tokenStore: TokenStore,
  ) {}

  async searchIssues(
    installationId: string,
    query: string,
  ): Promise<JiraTicketSummary[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const conn = await this.loadConnection(installationId);
    const seen = new Set<string>();
    const results: JiraTicketSummary[] = [];

    // 1. Exact key lookup first so the user's pasted key always wins.
    if (ISSUE_KEY_RE.test(trimmed.toUpperCase())) {
      try {
        const direct = await this.getIssueByKey(
          installationId,
          trimmed.toUpperCase(),
        );
        seen.add(direct.issueId);
        results.push(direct);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
    }

    // 2. Text search, sanitized for Lucene.
    const safeQuery = sanitizeLucene(trimmed);
    if (safeQuery.length > 0) {
      const jql = `text ~ "${safeQuery}" ORDER BY updated DESC`;
      const params = new URLSearchParams({
        jql,
        fields: JIRA_ISSUE_FIELDS.join(","),
        maxResults: String(SEARCH_MAX_RESULTS),
      });
      const data = await this.fetchJira<SearchResponse>(
        installationId,
        `/rest/api/3/search/jql?${params.toString()}`,
      );
      for (const issue of data.issues ?? []) {
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);
        results.push(toTicketSummary(issue, conn.site.url));
      }
    }

    return results.slice(0, SEARCH_MAX_RESULTS);
  }

  async getIssueByKey(
    installationId: string,
    issueKey: string,
  ): Promise<JiraTicketSummary> {
    const conn = await this.loadConnection(installationId);
    const params = new URLSearchParams({ fields: JIRA_ISSUE_FIELDS.join(",") });
    const issue = await this.fetchJira<JiraIssueResponse>(
      installationId,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?${params.toString()}`,
    );
    return toTicketSummary(issue, conn.site.url);
  }

  private async loadConnection(
    installationId: string,
  ): Promise<JiraConnection> {
    const conn = await this.tokenStore.load(installationId);
    if (!conn) throw new NotAuthenticatedError();
    return conn;
  }

  /**
   * Perform a Jira REST call, refreshing the access token proactively when
   * close to expiry and reactively on a 401. A single refresh is attempted;
   * if that still fails, we surface `reauth_required`.
   */
  private async fetchJira<T>(
    installationId: string,
    path: string,
  ): Promise<T> {
    let conn = await this.loadConnection(installationId);

    if (conn.expiresAt - Date.now() < EXPIRY_BUFFER_MS) {
      conn = await this.refresh(conn);
    }

    let res = await this.callJira(conn, path);
    if (res.status === 401) {
      conn = await this.refresh(conn);
      res = await this.callJira(conn, path);
    }

    if (res.status === 404) throw new NotFoundError();
    if (res.status === 401) throw new ReauthRequiredError();
    if (res.status === 403) {
      throw new UpstreamError("Jira denied access to this resource.");
    }
    if (res.status === 429) {
      throw new UpstreamError("Jira rate limit reached. Try again shortly.");
    }
    if (!res.ok) {
      const body = await safeReadBody(res);
      throw new UpstreamError(
        `Jira request failed (HTTP ${res.status}): ${body}`,
      );
    }

    return (await res.json()) as T;
  }

  private callJira(conn: JiraConnection, path: string): Promise<Response> {
    const url = `${this.config.jira.apiBaseUrl}/ex/jira/${conn.site.cloudId}${path}`;
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        Accept: "application/json",
      },
    });
  }

  private async refresh(conn: JiraConnection): Promise<JiraConnection> {
    try {
      const token = await refreshAccessToken(
        this.config.jira,
        conn.refreshToken,
      );
      const updated: JiraConnection = {
        ...conn,
        accessToken: token.access_token,
        // Atlassian rotates refresh tokens; fall back to the old one only if
        // the response somehow omits a new one.
        refreshToken: token.refresh_token ?? conn.refreshToken,
        expiresAt: Date.now() + token.expires_in * 1000,
      };
      await this.tokenStore.save(updated);
      return updated;
    } catch (err) {
      console.error("[jira] token refresh failed:", err);
      if (err instanceof AtlassianApiError) {
        // Refresh token is dead (revoked, expired, etc.). Drop the
        // connection so the user is forced through OAuth again.
        await this.tokenStore.delete(conn.installationId);
      }
      throw new ReauthRequiredError();
    }
  }
}

// Strip Lucene reserved characters so a free-text query can't break JQL.
function sanitizeLucene(s: string): string {
  return s
    .replace(/[+\-&|!(){}\[\]^"~*?:\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}
