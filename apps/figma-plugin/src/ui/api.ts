import type {
  ConnectionStatus,
  GetIssueResponse,
  SearchIssuesResponse,
} from "@figma-jira/shared-types";

export type ApiClient = {
  getStatus(): Promise<ConnectionStatus>;
  authStartUrl(): string;
  disconnect(): Promise<void>;
  searchIssues(query: string, signal?: AbortSignal): Promise<SearchIssuesResponse>;
  getIssueByKey(issueKey: string, signal?: AbortSignal): Promise<GetIssueResponse>;
};

export function createApiClient(
  backendUrl: string,
  installationId: string,
): ApiClient {
  const qs = `installationId=${encodeURIComponent(installationId)}`;

  async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${backendUrl}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    // Our /api/issues endpoints always return a JSON envelope, including on
    // error (so the UI can map error codes). Other endpoints throw on non-OK.
    if (path.startsWith("/api/")) {
      return (await res.json()) as T;
    }
    if (!res.ok) {
      throw new Error(`Request failed: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    getStatus: () => getJson<ConnectionStatus>(`/auth/status?${qs}`),

    authStartUrl: () => `${backendUrl}/auth/jira/start?${qs}`,

    async disconnect() {
      const res = await fetch(`${backendUrl}/auth/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId }),
      });
      if (!res.ok) {
        throw new Error(`Disconnect failed: HTTP ${res.status}`);
      }
    },

    searchIssues: (query, signal) =>
      getJson<SearchIssuesResponse>(
        `/api/issues/search?${qs}&q=${encodeURIComponent(query)}`,
        signal,
      ),

    getIssueByKey: (issueKey, signal) =>
      getJson<GetIssueResponse>(
        `/api/issues/${encodeURIComponent(issueKey)}?${qs}`,
        signal,
      ),
  };
}
