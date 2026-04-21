import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectionStatus,
  PluginToUiMessage,
  UiToPluginMessage,
} from "@figma-jira/shared-types";
import { createApiClient, type ApiClient } from "./api";

type ViewState =
  | { kind: "booting" }
  | { kind: "loading"; installationId: string; backendUrl: string }
  | {
      kind: "not_connected";
      installationId: string;
      backendUrl: string;
    }
  | {
      kind: "connecting";
      installationId: string;
      backendUrl: string;
    }
  | {
      kind: "connected";
      installationId: string;
      backendUrl: string;
      status: Extract<ConnectionStatus, { connected: true }>;
    }
  | {
      kind: "error";
      installationId: string;
      backendUrl: string;
      message: string;
    };

const POLL_INTERVAL_MS = 2000;
const CONNECTING_TIMEOUT_MS = 5 * 60 * 1000;

function postToPlugin(msg: UiToPluginMessage) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

export function App() {
  const [view, setView] = useState<ViewState>({ kind: "booting" });
  const apiRef = useRef<ApiClient | null>(null);

  // 1. Wait for the sandbox to send us the installationId + backend URL.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as PluginToUiMessage | undefined;
      if (!msg || msg.type !== "init") return;
      apiRef.current = createApiClient(msg.backendUrl, msg.installationId);
      setView({
        kind: "loading",
        installationId: msg.installationId,
        backendUrl: msg.backendUrl,
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const checkStatus = useCallback(async (): Promise<ConnectionStatus | null> => {
    const api = apiRef.current;
    if (!api) return null;
    try {
      return await api.getStatus();
    } catch (err) {
      setView((prev) =>
        prev.kind === "booting"
          ? prev
          : {
              kind: "error",
              installationId: prev.installationId,
              backendUrl: prev.backendUrl,
              message:
                err instanceof Error ? err.message : "Failed to reach backend",
            },
      );
      return null;
    }
  }, []);

  // 2. On mount (after init), fetch initial status.
  useEffect(() => {
    if (view.kind !== "loading") return;
    let cancelled = false;
    void (async () => {
      const status = await checkStatus();
      if (cancelled || !status) return;
      setView(
        status.connected
          ? {
              kind: "connected",
              installationId: view.installationId,
              backendUrl: view.backendUrl,
              status,
            }
          : {
              kind: "not_connected",
              installationId: view.installationId,
              backendUrl: view.backendUrl,
            },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [view, checkStatus]);

  // 3. While connecting, poll status until connected or timeout.
  useEffect(() => {
    if (view.kind !== "connecting") return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      const status = await checkStatus();
      if (cancelled) return;
      if (status?.connected) {
        setView({
          kind: "connected",
          installationId: view.installationId,
          backendUrl: view.backendUrl,
          status,
        });
        return;
      }
      if (Date.now() - startedAt > CONNECTING_TIMEOUT_MS) {
        setView({
          kind: "error",
          installationId: view.installationId,
          backendUrl: view.backendUrl,
          message: "Timed out waiting for Jira auth. Try again.",
        });
        return;
      }
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    let timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, checkStatus]);

  const startAuth = useCallback(() => {
    if (view.kind !== "not_connected" && view.kind !== "error") return;
    const api = apiRef.current;
    if (!api) return;
    postToPlugin({ type: "open-external", url: api.authStartUrl() });
    setView({
      kind: "connecting",
      installationId: view.installationId,
      backendUrl: view.backendUrl,
    });
  }, [view]);

  const disconnect = useCallback(async () => {
    if (view.kind !== "connected") return;
    const api = apiRef.current;
    if (!api) return;
    try {
      await api.disconnect();
      setView({
        kind: "not_connected",
        installationId: view.installationId,
        backendUrl: view.backendUrl,
      });
    } catch (err) {
      setView({
        kind: "error",
        installationId: view.installationId,
        backendUrl: view.backendUrl,
        message: err instanceof Error ? err.message : "Disconnect failed",
      });
    }
  }, [view]);

  const recheck = useCallback(async () => {
    if (view.kind === "booting") return;
    setView({
      kind: "loading",
      installationId: view.installationId,
      backendUrl: view.backendUrl,
    });
  }, [view]);

  const body = useMemo(() => {
    switch (view.kind) {
      case "booting":
      case "loading":
        return <Centered>Loading…</Centered>;
      case "not_connected":
        return (
          <NotConnectedView
            onConnect={startAuth}
            backendUrl={view.backendUrl}
          />
        );
      case "connecting":
        return (
          <ConnectingView
            onRetry={() =>
              setView({
                kind: "not_connected",
                installationId: view.installationId,
                backendUrl: view.backendUrl,
              })
            }
          />
        );
      case "connected":
        return (
          <ConnectedView status={view.status} onDisconnect={disconnect} />
        );
      case "error":
        return <ErrorView message={view.message} onRetry={recheck} />;
    }
  }, [view, startAuth, disconnect, recheck]);

  return (
    <main style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.title}>Jira Tickets</h1>
        <p style={styles.subtitle}>Phase 2 — connect your Jira account</p>
      </header>
      <section style={styles.section}>{body}</section>
      <footer style={styles.footer}>
        <button
          style={styles.buttonGhost}
          onClick={() => postToPlugin({ type: "close" })}
        >
          Close
        </button>
      </footer>
    </main>
  );
}

function NotConnectedView({
  onConnect,
  backendUrl,
}: {
  onConnect: () => void;
  backendUrl: string;
}) {
  return (
    <>
      <p style={styles.body}>
        Connect your Jira account to place tickets on the canvas.
      </p>
      <button style={styles.buttonPrimary} onClick={onConnect}>
        Connect Jira
      </button>
      <p style={styles.hint}>Backend: {backendUrl}</p>
    </>
  );
}

function ConnectingView({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p style={styles.body}>
        A new browser tab should have opened. Approve access in Jira — this
        screen will update automatically.
      </p>
      <p style={styles.hint}>Still waiting…</p>
      <button style={styles.buttonGhost} onClick={onRetry}>
        Cancel
      </button>
    </>
  );
}

function ConnectedView({
  status,
  onDisconnect,
}: {
  status: Extract<ConnectionStatus, { connected: true }>;
  onDisconnect: () => void;
}) {
  const who =
    status.account.displayName ??
    status.account.email ??
    status.account.accountId ??
    "Connected";
  return (
    <>
      <div style={styles.card}>
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}>Site</span>
          <span style={styles.cardValue}>{status.site.name}</span>
        </div>
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}>URL</span>
          <span style={styles.cardValue}>{status.site.url}</span>
        </div>
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}>Account</span>
          <span style={styles.cardValue}>{who}</span>
        </div>
      </div>
      <p style={styles.hint}>Issue search lands in the next phase.</p>
      <button style={styles.buttonDanger} onClick={onDisconnect}>
        Disconnect
      </button>
    </>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <>
      <p style={{ ...styles.body, color: "#B00020" }}>{message}</p>
      <button style={styles.buttonPrimary} onClick={onRetry}>
        Try again
      </button>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <p style={{ ...styles.body, color: "#888" }}>{children}</p>;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 12,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    boxSizing: "border-box",
  },
  header: { marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 600, margin: 0 },
  subtitle: { margin: "4px 0 0", color: "#888" },
  section: { flex: 1, display: "flex", flexDirection: "column", gap: 12 },
  body: { margin: 0, lineHeight: 1.5 },
  hint: { color: "#888", margin: 0 },
  card: {
    border: "1px solid #E5E7EB",
    borderRadius: 8,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "#FAFAFA",
  },
  cardRow: { display: "flex", gap: 8, alignItems: "baseline" },
  cardLabel: { width: 64, color: "#6B7280" },
  cardValue: { flex: 1, fontWeight: 500, wordBreak: "break-word" },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },
  buttonPrimary: {
    padding: "8px 12px",
    background: "#0B5FFF",
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 500,
  },
  buttonGhost: {
    padding: "6px 12px",
    background: "transparent",
    border: "1px solid #ddd",
    borderRadius: 6,
    cursor: "pointer",
  },
  buttonDanger: {
    padding: "8px 12px",
    background: "transparent",
    color: "#B00020",
    border: "1px solid #F3C2CA",
    borderRadius: 6,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
};
