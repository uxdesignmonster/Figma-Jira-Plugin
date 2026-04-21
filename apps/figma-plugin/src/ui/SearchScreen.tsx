import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BackendError,
  ConnectionStatus,
  JiraTicketSummary,
  PluginToUiMessage,
  UiToPluginMessage,
} from "@figma-jira/shared-types";
import type { ApiClient } from "./api";

function postToPlugin(msg: UiToPluginMessage) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

type InsertStatus =
  | { kind: "idle" }
  | { kind: "inserting" }
  | { kind: "inserted"; issueKey: string }
  | { kind: "error"; message: string };

type Props = {
  api: ApiClient;
  connection: Extract<ConnectionStatus, { connected: true }>;
  onReauth: () => void;
};

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; tickets: JiraTicketSummary[] }
  | { kind: "empty" }
  | { kind: "error"; error: BackendError };

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

export function SearchScreen({ api, connection, onReauth }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [selected, setSelected] = useState<JiraTicketSummary | null>(null);
  const [insertStatus, setInsertStatus] = useState<InsertStatus>({
    kind: "idle",
  });
  const requestSeq = useRef(0);

  // Listen for insert-widget results from the plugin sandbox.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as PluginToUiMessage | undefined;
      if (!msg || msg.type !== "insert-widget-result") return;
      if (msg.ok) {
        setInsertStatus({ kind: "inserted", issueKey: msg.issueKey });
      } else {
        setInsertStatus({ kind: "error", message: msg.error });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Reset insert status whenever the user switches selection.
  useEffect(() => {
    setInsertStatus({ kind: "idle" });
  }, [selected?.issueId]);

  const handleInsert = (ticket: JiraTicketSummary) => {
    setInsertStatus({ kind: "inserting" });
    postToPlugin({ type: "insert-widget", ticket });
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setState({ kind: "idle" });
      return;
    }

    const seq = ++requestSeq.current;
    const controller = new AbortController();
    setState({ kind: "searching" });

    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchIssues(trimmed, controller.signal);
        if (seq !== requestSeq.current) return;
        if (!res.ok) {
          setState({ kind: "error", error: res.error });
          return;
        }
        setState(
          res.tickets.length === 0
            ? { kind: "empty" }
            : { kind: "results", tickets: res.tickets },
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        if (seq !== requestSeq.current) return;
        setState({
          kind: "error",
          error: {
            code: "upstream_error",
            message:
              err instanceof Error ? err.message : "Search request failed.",
          },
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, api]);

  const resultList = useMemo(() => {
    if (state.kind === "searching") return <Hint>Searching…</Hint>;
    if (state.kind === "idle") return <Hint>Type at least 2 characters.</Hint>;
    if (state.kind === "empty") return <Hint>No matching issues.</Hint>;
    if (state.kind === "error") {
      const needsReauth =
        state.error.code === "unauthenticated" ||
        state.error.code === "reauth_required";
      return (
        <div style={styles.errorBox}>
          <p style={styles.errorText}>{state.error.message}</p>
          {needsReauth && (
            <button style={styles.buttonPrimary} onClick={onReauth}>
              Reconnect Jira
            </button>
          )}
        </div>
      );
    }
    return (
      <ul style={styles.list}>
        {state.tickets.map((t) => (
          <li key={t.issueId}>
            <ResultRow
              ticket={t}
              active={selected?.issueId === t.issueId}
              onSelect={() => setSelected(t)}
            />
          </li>
        ))}
      </ul>
    );
  }, [state, selected, onReauth]);

  return (
    <>
      <div style={styles.siteBar}>
        <span style={styles.siteName}>{connection.site.name}</span>
      </div>

      <input
        type="search"
        style={styles.input}
        placeholder="Search Jira (or paste an issue key)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div style={styles.results}>{resultList}</div>

      {selected && (
        <SelectedPanel
          ticket={selected}
          status={insertStatus}
          onClear={() => setSelected(null)}
          onInsert={() => handleInsert(selected)}
        />
      )}
    </>
  );
}

function ResultRow({
  ticket,
  active,
  onSelect,
}: {
  ticket: JiraTicketSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ ...styles.row, ...(active ? styles.rowActive : null) }}
    >
      <div style={styles.rowHeader}>
        <span style={styles.issueKey}>{ticket.issueKey}</span>
        <span style={styles.status}>{ticket.status}</span>
      </div>
      <div style={styles.summary}>{ticket.summary || "(no summary)"}</div>
      <div style={styles.meta}>
        <span>{ticket.assigneeName ?? "Unassigned"}</span>
        <span>·</span>
        <span>Updated {formatUpdated(ticket.updatedAt)}</span>
      </div>
    </button>
  );
}

function SelectedPanel({
  ticket,
  status,
  onClear,
  onInsert,
}: {
  ticket: JiraTicketSummary;
  status: InsertStatus;
  onClear: () => void;
  onInsert: () => void;
}) {
  const inserting = status.kind === "inserting";
  return (
    <div style={styles.selected}>
      <div style={styles.selectedHeader}>
        <span style={styles.selectedLabel}>Selected</span>
        <button style={styles.linkButton} onClick={onClear}>
          Clear
        </button>
      </div>
      <div style={styles.selectedBody}>
        <strong>{ticket.issueKey}</strong> — {ticket.summary || "(no summary)"}
      </div>
      <button
        style={{
          ...styles.buttonPrimary,
          ...(inserting ? styles.buttonDisabled : null),
        }}
        onClick={onInsert}
        disabled={inserting}
      >
        {inserting ? "Inserting…" : "Insert ticket on canvas"}
      </button>
      {status.kind === "inserted" && (
        <p style={styles.insertSuccess}>
          Inserted {status.issueKey} on the canvas.
        </p>
      )}
      {status.kind === "error" && (
        <p style={styles.insertError}>{status.message}</p>
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p style={styles.hint}>{children}</p>;
}

function formatUpdated(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const styles: Record<string, React.CSSProperties> = {
  siteBar: {
    fontSize: 11,
    color: "#6B7280",
    paddingBottom: 4,
    borderBottom: "1px solid #F0F0F0",
  },
  siteName: { fontWeight: 500 },
  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #ddd",
    borderRadius: 6,
    boxSizing: "border-box",
    fontSize: 12,
    fontFamily: "inherit",
  },
  results: {
    flex: 1,
    overflowY: "auto",
    margin: "4px -16px",
    padding: "0 16px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    border: "1px solid transparent",
    borderBottom: "1px solid #F0F0F0",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
  },
  rowActive: {
    background: "#EBF2FF",
    border: "1px solid #C6D6FF",
    borderRadius: 6,
  },
  rowHeader: { display: "flex", justifyContent: "space-between", gap: 8 },
  issueKey: { fontFamily: "monospace", color: "#0B5FFF", fontWeight: 600 },
  status: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    color: "#6B7280",
    background: "#F3F4F6",
    padding: "1px 6px",
    borderRadius: 4,
  },
  summary: { fontWeight: 500, lineHeight: 1.3 },
  meta: { display: "flex", gap: 6, color: "#6B7280", fontSize: 11 },
  selected: {
    borderTop: "1px solid #E5E7EB",
    paddingTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  selectedHeader: { display: "flex", justifyContent: "space-between" },
  selectedLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "#6B7280",
  },
  selectedBody: { lineHeight: 1.4 },
  linkButton: {
    background: "transparent",
    border: "none",
    color: "#0B5FFF",
    cursor: "pointer",
    fontSize: 11,
    padding: 0,
  },
  hint: { color: "#888", margin: 0, padding: "8px 2px" },
  errorBox: {
    padding: 10,
    border: "1px solid #F3C2CA",
    borderRadius: 6,
    background: "#FFF5F6",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  errorText: { color: "#B00020", margin: 0, fontSize: 12 },
  buttonPrimary: {
    padding: "8px 12px",
    background: "#0B5FFF",
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 500,
    alignSelf: "flex-start",
  },
  buttonDisabled: {
    background: "#7FA8FF",
    cursor: "default",
  },
  insertSuccess: {
    margin: 0,
    color: "#116633",
    fontSize: 11,
  },
  insertError: {
    margin: 0,
    color: "#B00020",
    fontSize: 11,
  },
};
