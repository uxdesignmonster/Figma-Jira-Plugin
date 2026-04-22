import type {
  GetIssueResponse,
  JiraTicketSummary,
  RegisterWidgetResponse,
  RefreshWidgetResponse,
  WidgetStatusResponse,
} from "@figma-jira/shared-types";
import {
  BACKEND_URL,
  INSTALLATION_STORAGE_KEY,
  WIDGET_STATE_KEYS,
} from "./constants";

const { widget } = figma;
const {
  AutoLayout,
  Text,
  useSyncedState,
  useEffect,
  useWidgetNodeId,
  waitForTask,
  SVG,
} = widget;

const COLORS = {
  surface: "#FFFFFF",
  border: "#E5E7EB",
  muted: "#6B7280",
  text: "#111827",
  accent: "#0B5FFF",
  danger: "#B00020",
  pillBg: "#F3F4F6",
  loadingBg: "#EBF2FF",
  staleText: "#92400E",
  staleBg: "#FFF7E6",
  staleBorder: "#F4D58A",
} as const;

const REFRESH_ICON_SRC = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><polyline points="21 4 21 10 15 10"/></svg>`;

/**
 * Per-sandbox guard: the mount effect fires on every render (widget
 * `useEffect` has no deps array). We track which (nodeId, linkId) pairs have
 * already been synced so we only fire one freshness or reconciliation fetch
 * per widget per sandbox load.
 */
const reconciled = new Set<string>();

type LinkState =
  | { kind: "ok"; linkId: string }
  | { kind: "unlinked" }
  | { kind: "broken"; reason: string };

export function TicketWidget() {
  const [ticket, setTicket] = useSyncedState<JiraTicketSummary | null>(
    WIDGET_STATE_KEYS.ticket,
    null,
  );
  const [lastSyncedAt, setLastSyncedAt] = useSyncedState<string | null>(
    WIDGET_STATE_KEYS.lastSyncedAt,
    null,
  );
  const [isLoading, setIsLoading] = useSyncedState<boolean>(
    WIDGET_STATE_KEYS.isLoading,
    false,
  );
  const [error, setError] = useSyncedState<string | null>(
    WIDGET_STATE_KEYS.error,
    null,
  );
  const [backendLinkId, setBackendLinkId] = useSyncedState<string | null>(
    WIDGET_STATE_KEYS.backendLinkId,
    null,
  );
  const [isStale, setIsStale] = useSyncedState<boolean>(
    WIDGET_STATE_KEYS.isStale,
    false,
  );
  const [registeredNodeId, setRegisteredNodeId] = useSyncedState<string | null>(
    WIDGET_STATE_KEYS.registeredNodeId,
    null,
  );

  const myNodeId = useWidgetNodeId();
  const isClone =
    registeredNodeId !== null && registeredNodeId !== myNodeId;

  const linkState: LinkState = (() => {
    if (isClone) return { kind: "unlinked" };
    if (!backendLinkId) return { kind: "unlinked" };
    return { kind: "ok", linkId: backendLinkId };
  })();

  // One-shot reconciliation: detect clones (clear stale link id), check
  // staleness on the real link. See `reconciled` guard above.
  useEffect(() => {
    if (!ticket) return;
    const guard = `${myNodeId}|${backendLinkId ?? "none"}|${registeredNodeId ?? "none"}`;
    if (reconciled.has(guard)) return;
    reconciled.add(guard);

    if (isClone) {
      // Clone detected: we can't re-register yet (need installationId +
      // user-triggered network call). Just clear the stale carried-over
      // link id so the "Reconnect ticket" button appears.
      setBackendLinkId(null);
      setRegisteredNodeId(null);
      setIsStale(false);
      return;
    }

    if (!backendLinkId) return;
    waitForTask(
      reconcileFreshness(backendLinkId, (nextStale, errorKind) => {
        if (errorKind === "link_not_found") {
          // Backend lost our link (DB restore, manual delete). Drop the
          // local link id; UI will show Reconnect.
          setBackendLinkId(null);
          setRegisteredNodeId(null);
          setIsStale(false);
        } else if (nextStale !== null && nextStale !== isStale) {
          setIsStale(nextStale);
        }
      }),
    );
  });

  async function refresh() {
    if (!ticket || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const result =
        linkState.kind === "ok"
          ? await refreshViaLink(linkState.linkId)
          : await refreshViaIssueKey(ticket.issueKey);
      if (!result.ok) {
        if (result.code === "link_not_found") {
          // Drop the link and fall through to the Reconnect UI instead of
          // repeatedly surfacing the error.
          setBackendLinkId(null);
          setRegisteredNodeId(null);
        }
        setError(translateError(result.code, result.message));
        return;
      }
      setTicket(result.ticket);
      setLastSyncedAt(new Date().toISOString());
      setIsStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function reconnect() {
    if (!ticket || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await registerLinkFor(ticket, myNodeId);
      if (!result.ok) {
        setError(translateError(result.code, result.message));
        return;
      }
      setBackendLinkId(result.linkId);
      setRegisteredNodeId(myNodeId);
      setLastSyncedAt(new Date().toISOString());
      setIsStale(false);
      // Reset the guard so a follow-up freshness check can run if Jira
      // changes under the new link.
      reconciled.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconnect failed.");
    } finally {
      setIsLoading(false);
    }
  }

  if (!ticket) {
    return (
      <AutoLayout
        direction="vertical"
        padding={16}
        cornerRadius={8}
        fill={COLORS.surface}
        stroke={COLORS.border}
        width={320}
      >
        <Text fontSize={12} fill={COLORS.muted}>
          Jira ticket · waiting for data…
        </Text>
      </AutoLayout>
    );
  }

  const unlinked = linkState.kind === "unlinked";

  return (
    <AutoLayout
      direction="vertical"
      padding={14}
      spacing={8}
      cornerRadius={8}
      fill={COLORS.surface}
      stroke={isStale ? COLORS.staleBorder : COLORS.border}
      width={320}
      effect={{
        type: "drop-shadow",
        color: { r: 0, g: 0, b: 0, a: 0.06 },
        offset: { x: 0, y: 1 },
        blur: 3,
      }}
    >
      <AutoLayout
        direction="horizontal"
        spacing="auto"
        width="fill-parent"
        verticalAlignItems="center"
      >
        <Text
          fontSize={12}
          fontFamily="Inter"
          fontWeight={600}
          fill={COLORS.accent}
          onClick={() => openInJira(ticket.url)}
        >
          {ticket.issueKey}
        </Text>
        <AutoLayout
          padding={{ vertical: 2, horizontal: 6 }}
          cornerRadius={4}
          fill={COLORS.pillBg}
        >
          <Text
            fontSize={10}
            fontFamily="Inter"
            fontWeight={500}
            fill={COLORS.muted}
          >
            {ticket.status.toUpperCase()}
          </Text>
        </AutoLayout>
      </AutoLayout>

      <Text
        fontSize={14}
        fontFamily="Inter"
        fontWeight={600}
        fill={COLORS.text}
        width="fill-parent"
      >
        {ticket.summary || "(no summary)"}
      </Text>

      <AutoLayout direction="horizontal" spacing={6} width="fill-parent">
        <Text fontSize={11} fill={COLORS.muted}>
          {ticket.assigneeName ?? "Unassigned"}
        </Text>
        <Text fontSize={11} fill={COLORS.muted}>
          ·
        </Text>
        <Text fontSize={11} fill={COLORS.muted}>
          Updated {formatRelative(ticket.updatedAt)}
        </Text>
      </AutoLayout>

      {isStale && (
        <AutoLayout
          padding={{ vertical: 4, horizontal: 8 }}
          cornerRadius={6}
          fill={COLORS.staleBg}
          stroke={COLORS.staleBorder}
          width="hug-contents"
        >
          <Text fontSize={11} fontWeight={500} fill={COLORS.staleText}>
            Updated in Jira · refresh to sync
          </Text>
        </AutoLayout>
      )}

      {unlinked && (
        <AutoLayout
          padding={{ vertical: 4, horizontal: 8 }}
          cornerRadius={6}
          fill={COLORS.pillBg}
          width="hug-contents"
        >
          <Text fontSize={11} fill={COLORS.muted}>
            Not linked to backend · reconnect to track Jira changes
          </Text>
        </AutoLayout>
      )}

      {error !== null && (
        <AutoLayout
          padding={8}
          cornerRadius={6}
          fill="#FFF5F6"
          stroke="#F3C2CA"
          width="fill-parent"
        >
          <Text fontSize={11} fill={COLORS.danger} width="fill-parent">
            {error}
          </Text>
        </AutoLayout>
      )}

      <AutoLayout
        direction="horizontal"
        spacing="auto"
        width="fill-parent"
        verticalAlignItems="center"
        padding={{ top: 4 }}
      >
        <AutoLayout
          padding={{ vertical: 4, horizontal: 8 }}
          cornerRadius={6}
          fill={isLoading ? COLORS.loadingBg : "#F9FAFB"}
          stroke={COLORS.border}
          spacing={6}
          verticalAlignItems="center"
          onClick={unlinked ? reconnect : refresh}
          hoverStyle={{ fill: COLORS.loadingBg }}
        >
          <SVG src={REFRESH_ICON_SRC} />
          <Text fontSize={11} fill={COLORS.muted}>
            {isLoading
              ? unlinked
                ? "Reconnecting…"
                : "Refreshing…"
              : unlinked
                ? "Reconnect ticket"
                : lastSyncedAt
                  ? `Refreshed ${formatRelative(lastSyncedAt)}`
                  : "Refresh"}
          </Text>
        </AutoLayout>
        <Text
          fontSize={11}
          fill={COLORS.accent}
          onClick={() => openInJira(ticket.url)}
        >
          Open in Jira ↗
        </Text>
      </AutoLayout>
    </AutoLayout>
  );
}

type RefreshOutcome =
  | { ok: true; ticket: JiraTicketSummary }
  | { ok: false; code: string; message: string };

async function refreshViaLink(linkId: string): Promise<RefreshOutcome> {
  const res = await fetch(
    `${BACKEND_URL}/api/widgets/${encodeURIComponent(linkId)}/refresh`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  const body = (await res.json()) as RefreshWidgetResponse;
  return body.ok
    ? { ok: true, ticket: body.ticket }
    : { ok: false, code: body.error.code, message: body.error.message };
}

async function refreshViaIssueKey(issueKey: string): Promise<RefreshOutcome> {
  const installationId = await figma.clientStorage.getAsync(
    INSTALLATION_STORAGE_KEY,
  );
  if (typeof installationId !== "string" || installationId.length === 0) {
    return {
      ok: false,
      code: "unauthenticated",
      message: "Not connected. Open the Jira plugin to reconnect.",
    };
  }
  const url = `${BACKEND_URL}/api/issues/${encodeURIComponent(
    issueKey,
  )}?installationId=${encodeURIComponent(installationId)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json()) as GetIssueResponse;
  return body.ok
    ? { ok: true, ticket: body.ticket }
    : { ok: false, code: body.error.code, message: body.error.message };
}

type RegisterOutcome =
  | { ok: true; linkId: string }
  | { ok: false; code: string; message: string };

async function registerLinkFor(
  ticket: JiraTicketSummary,
  widgetNodeId: string,
): Promise<RegisterOutcome> {
  const installationId = await figma.clientStorage.getAsync(
    INSTALLATION_STORAGE_KEY,
  );
  if (typeof installationId !== "string" || installationId.length === 0) {
    return {
      ok: false,
      code: "unauthenticated",
      message: "Not connected. Open the Jira plugin to reconnect.",
    };
  }
  const res = await fetch(`${BACKEND_URL}/api/widgets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      installationId,
      widgetNodeId,
      widgetId: figma.widgetId ?? "",
      fileKey: figma.fileKey ?? null,
      fileName: figma.root?.name ?? null,
      issueId: ticket.issueId,
      issueKey: ticket.issueKey,
      issueUpdatedAt: ticket.updatedAt,
    }),
  });
  const body = (await res.json()) as RegisterWidgetResponse;
  return body.ok
    ? { ok: true, linkId: body.link.linkId }
    : { ok: false, code: body.error.code, message: body.error.message };
}

async function reconcileFreshness(
  linkId: string,
  apply: (
    nextStale: boolean | null,
    errorKind: "link_not_found" | "other" | null,
  ) => void,
): Promise<void> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/widgets/${encodeURIComponent(linkId)}/status`,
      { headers: { Accept: "application/json" } },
    );
    const body = (await res.json()) as WidgetStatusResponse;
    if (!body.ok) {
      apply(null, body.error.code === "link_not_found" ? "link_not_found" : "other");
      return;
    }
    apply(body.link.isStale, null);
  } catch {
    // Backend unreachable — keep current synced state.
    apply(null, null);
  }
}

function openInJira(url: string) {
  figma.openExternal(url);
}

function translateError(code: string, message: string): string {
  if (code === "unauthenticated" || code === "reauth_required") {
    return "Jira session expired. Open the plugin to reconnect.";
  }
  if (code === "not_found") {
    return "Issue no longer accessible on Jira.";
  }
  if (code === "link_not_found") {
    return "Backend lost this widget's link. Click Reconnect ticket to repair.";
  }
  return message;
}

function formatRelative(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
