import type {
  JiraTicketSummary,
  PluginToUiMessage,
  RegisterWidgetRequest,
  RegisterWidgetResponse,
  UiToPluginMessage,
} from "@figma-jira/shared-types";
import { TicketWidget } from "./widget/TicketWidget";
import {
  BACKEND_URL,
  INSTALLATION_STORAGE_KEY,
  WIDGET_STATE_KEYS,
} from "./widget/constants";

// Widget registration must run at module load, unconditionally. Figma
// loads this file both to render the widget on canvas *and* to execute
// plugin menu commands — only the plugin-menu path shows UI.
figma.widget.register(TicketWidget);

if (figma.command === "insert") {
  void runPluginUi();
}

async function runPluginUi(): Promise<void> {
  figma.showUI(__html__, { width: 360, height: 520, themeColors: true });

  const installationId = await getOrCreateInstallationId();
  postToUi({ type: "init", installationId, backendUrl: BACKEND_URL });

  figma.ui.onmessage = (msg: UiToPluginMessage) => {
    if (msg.type === "close") {
      figma.closePlugin();
      return;
    }

    if (msg.type === "open-external") {
      figma.openExternal(msg.url);
      return;
    }

    if (msg.type === "insert-widget") {
      void handleInsertWidget(msg.ticket);
      return;
    }
  };
}

async function handleInsertWidget(ticket: JiraTicketSummary): Promise<void> {
  let widgetNode: WidgetNode | null = null;
  try {
    widgetNode = await createTicketWidgetNode();
    const { x, y } = figma.viewport.center;
    widgetNode.x = Math.round(x - widgetNode.width / 2);
    widgetNode.y = Math.round(y - widgetNode.height / 2);
    figma.currentPage.selection = [widgetNode];
    figma.viewport.scrollAndZoomIntoView([widgetNode]);

    // Register with backend *after* the node exists so we can send the real
    // `WidgetNode.id` (Figma's canvas node id — stable per instance). If
    // registration fails we still seed the widget with the ticket: the card
    // stays usable, `backendLinkId` is null, and refresh falls back to the
    // per-issue endpoint.
    const installationId = await getOrCreateInstallationId();
    const registration = await tryRegisterWidgetLink({
      installationId,
      widgetNodeId: widgetNode.id,
      widgetId: widgetNode.widgetId,
      fileKey: figma.fileKey ?? null,
      fileName: figma.root.name ?? null,
      issueId: ticket.issueId,
      issueKey: ticket.issueKey,
      issueUpdatedAt: ticket.updatedAt,
    });

    seedWidgetState(widgetNode, {
      ticket,
      backendLinkId: registration.linkId,
      errorMessage: registration.error,
    });

    figma.notify(`Inserted ${ticket.issueKey}`);
    postToUi({
      type: "insert-widget-result",
      ok: true,
      issueKey: ticket.issueKey,
    });
  } catch (err) {
    console.error("[plugin] insert failed", err);
    const message = err instanceof Error ? err.message : "Insert failed.";
    if (widgetNode) widgetNode.remove();
    figma.notify(`Couldn't insert widget: ${message}`, { error: true });
    postToUi({ type: "insert-widget-result", ok: false, error: message });
  }
}

/**
 * Programmatically create a new TicketWidget instance on the canvas.
 *
 * Figma requires two steps for a pre-seeded widget:
 *   1. `figma.createNodeFromJSXAsync(<TicketWidget/>)` to instantiate a
 *      WidgetNode of our registered widget. This works because the widget
 *      is registered in *this same manifest* — the sandbox's `figma.widgetId`
 *      therefore matches the node's `widgetId`.
 *   2. `WidgetNode.setWidgetSyncedState(...)` to seed initial synced state.
 *      This API is restricted to widgets with a matching `widgetId`, which
 *      is why the plugin and widget have to share one manifest.
 *
 * The brief interval where the widget renders with defaults is handled by
 * TicketWidget's `ticket == null → "waiting for data…"` branch.
 */
async function createTicketWidgetNode(): Promise<WidgetNode> {
  const node = await figma.createNodeFromJSXAsync(<TicketWidget />);
  if (node.type !== "WIDGET") {
    throw new Error(
      `Expected a WidgetNode from createNodeFromJSXAsync, got ${node.type}.`,
    );
  }
  return node as WidgetNode;
}

function seedWidgetState(
  widgetNode: WidgetNode,
  opts: {
    ticket: JiraTicketSummary;
    backendLinkId: string | null;
    errorMessage: string | null;
  },
): void {
  widgetNode.setWidgetSyncedState({
    [WIDGET_STATE_KEYS.ticket]: opts.ticket,
    [WIDGET_STATE_KEYS.lastSyncedAt]: new Date().toISOString(),
    [WIDGET_STATE_KEYS.isLoading]: false,
    [WIDGET_STATE_KEYS.error]: opts.errorMessage,
    [WIDGET_STATE_KEYS.backendLinkId]: opts.backendLinkId,
    [WIDGET_STATE_KEYS.isStale]: false,
    // Record which node id the link was registered against. The widget code
    // compares this with `useWidgetNodeId()` at render time to detect clones.
    [WIDGET_STATE_KEYS.registeredNodeId]: widgetNode.id,
  });
}

async function tryRegisterWidgetLink(
  req: RegisterWidgetRequest,
): Promise<{ linkId: string | null; error: string | null }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/widgets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(req),
    });
    const body = (await res.json()) as RegisterWidgetResponse;
    if (!body.ok) {
      return {
        linkId: null,
        error: `Backend registration failed: ${body.error.message}`,
      };
    }
    return { linkId: body.link.linkId, error: null };
  } catch (err) {
    console.warn("[plugin] widget registration failed", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return {
      linkId: null,
      error: `Backend unreachable (${message}). Widget will still refresh by issue key.`,
    };
  }
}

async function getOrCreateInstallationId(): Promise<string> {
  const existing = await figma.clientStorage.getAsync(INSTALLATION_STORAGE_KEY);
  if (typeof existing === "string" && existing.length > 0) return existing;
  const fresh = generateInstallationId();
  await figma.clientStorage.setAsync(INSTALLATION_STORAGE_KEY, fresh);
  return fresh;
}

function generateInstallationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function postToUi(msg: PluginToUiMessage): void {
  figma.ui.postMessage(msg);
}
