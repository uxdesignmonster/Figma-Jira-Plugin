import type {
  GetIssueResponse,
  JiraTicketSummary,
} from "@figma-jira/shared-types";
import {
  BACKEND_URL,
  INSTALLATION_STORAGE_KEY,
  WIDGET_STATE_KEYS,
} from "./constants";

const { widget } = figma;
const { AutoLayout, Text, useSyncedState, SVG } = widget;

const COLORS = {
  surface: "#FFFFFF",
  border: "#E5E7EB",
  muted: "#6B7280",
  text: "#111827",
  accent: "#0B5FFF",
  danger: "#B00020",
  pillBg: "#F3F4F6",
  loadingBg: "#EBF2FF",
} as const;

// 12px refresh icon rendered as inline SVG so the widget has no external deps.
const REFRESH_ICON_SRC = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><polyline points="21 4 21 10 15 10"/></svg>`;

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

  async function refresh() {
    if (!ticket || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const installationId = await figma.clientStorage.getAsync(
        INSTALLATION_STORAGE_KEY,
      );
      if (typeof installationId !== "string" || installationId.length === 0) {
        setError("Not connected. Open the Jira plugin to reconnect.");
        return;
      }
      const url = `${BACKEND_URL}/api/issues/${encodeURIComponent(
        ticket.issueKey,
      )}?installationId=${encodeURIComponent(installationId)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const body = (await res.json()) as GetIssueResponse;
      if (!body.ok) {
        setError(translateError(body.error.code, body.error.message));
        return;
      }
      setTicket(body.ticket);
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
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

  return (
    <AutoLayout
      direction="vertical"
      padding={14}
      spacing={8}
      cornerRadius={8}
      fill={COLORS.surface}
      stroke={COLORS.border}
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

      <AutoLayout
        direction="horizontal"
        spacing={6}
        width="fill-parent"
      >
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
          onClick={refresh}
          hoverStyle={{ fill: COLORS.loadingBg }}
        >
          <SVG src={REFRESH_ICON_SRC} />
          <Text fontSize={11} fill={COLORS.muted}>
            {isLoading
              ? "Refreshing…"
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
