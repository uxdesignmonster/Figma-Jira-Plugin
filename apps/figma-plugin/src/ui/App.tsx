import { useState } from "react";
import type { UiToPluginMessage } from "@figma-jira/shared-types";

const postToPlugin = (msg: UiToPluginMessage) => {
  parent.postMessage({ pluginMessage: msg }, "*");
};

export function App() {
  const [query, setQuery] = useState("");

  return (
    <main style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.title}>Jira Tickets</h1>
        <p style={styles.subtitle}>Phase 0 — scaffold only</p>
      </header>

      <section style={styles.section}>
        <label style={styles.label} htmlFor="issue-key">
          Issue key
        </label>
        <input
          id="issue-key"
          style={styles.input}
          placeholder="e.g. DES-123"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled
        />
        <p style={styles.hint}>
          Search + auth flows land in the next phase.
        </p>
      </section>

      <footer style={styles.footer}>
        <button style={styles.buttonGhost} onClick={() => postToPlugin({ type: "close" })}>
          Close
        </button>
      </footer>
    </main>
  );
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
  header: { marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 600, margin: 0 },
  subtitle: { margin: "4px 0 0", color: "#888" },
  section: { flex: 1 },
  label: { display: "block", fontWeight: 500, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #ddd",
    borderRadius: 6,
    boxSizing: "border-box",
  },
  hint: { color: "#888", marginTop: 8 },
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 },
  buttonGhost: {
    padding: "6px 12px",
    background: "transparent",
    border: "1px solid #ddd",
    borderRadius: 6,
    cursor: "pointer",
  },
};
