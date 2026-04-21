import type {
  PluginToUiMessage,
  UiToPluginMessage,
} from "@figma-jira/shared-types";

// Backend URL is hardcoded for MVP. In a later phase this becomes a
// build-time constant / configurable setting.
const BACKEND_URL = "http://localhost:4000";
const INSTALLATION_STORAGE_KEY = "figma-jira.installationId";

function generateInstallationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateInstallationId(): Promise<string> {
  const existing = await figma.clientStorage.getAsync(INSTALLATION_STORAGE_KEY);
  if (typeof existing === "string" && existing.length > 0) return existing;
  const fresh = generateInstallationId();
  await figma.clientStorage.setAsync(INSTALLATION_STORAGE_KEY, fresh);
  return fresh;
}

function postToUi(msg: PluginToUiMessage) {
  figma.ui.postMessage(msg);
}

async function main() {
  figma.showUI(__html__, { width: 360, height: 520, themeColors: true });

  const installationId = await getOrCreateInstallationId();
  postToUi({ type: "init", installationId, backendUrl: BACKEND_URL });

  figma.ui.onmessage = (msg: UiToPluginMessage) => {
    if (msg.type === "close") {
      figma.closePlugin();
      return;
    }

    if (msg.type === "open-external") {
      // Opens the URL in the user's default browser, outside Figma.
      figma.openExternal(msg.url);
      return;
    }

    if (msg.type === "insert-widget") {
      // Wired up in a later phase.
      figma.notify(`Would insert widget for ${msg.ticket.issueKey}`);
      postToUi({ type: "insert-widget-result", ok: true });
      return;
    }
  };
}

main().catch((err) => {
  console.error("[plugin] bootstrap failed", err);
  figma.notify("Plugin failed to start");
  figma.closePlugin();
});
