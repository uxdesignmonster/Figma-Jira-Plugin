import type { ConnectionStatus } from "@figma-jira/shared-types";

export type ApiClient = {
  getStatus(): Promise<ConnectionStatus>;
  authStartUrl(): string;
  disconnect(): Promise<void>;
};

export function createApiClient(
  backendUrl: string,
  installationId: string,
): ApiClient {
  const qs = `installationId=${encodeURIComponent(installationId)}`;

  return {
    async getStatus() {
      const res = await fetch(`${backendUrl}/auth/status?${qs}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Status request failed: HTTP ${res.status}`);
      }
      return (await res.json()) as ConnectionStatus;
    },

    authStartUrl() {
      return `${backendUrl}/auth/jira/start?${qs}`;
    },

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
  };
}
