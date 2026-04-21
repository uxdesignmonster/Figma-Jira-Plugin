import type {
  PluginToUiMessage,
  UiToPluginMessage,
} from "@figma-jira/shared-types";

figma.showUI(__html__, { width: 360, height: 480, themeColors: true });

figma.ui.onmessage = (msg: UiToPluginMessage) => {
  if (msg.type === "close") {
    figma.closePlugin();
    return;
  }

  if (msg.type === "insert-widget") {
    // Widget insertion is wired up in a later phase.
    // For now just acknowledge and notify the canvas.
    figma.notify(`Would insert widget for ${msg.ticket.issueKey}`);
    const reply: PluginToUiMessage = {
      type: "insert-widget-result",
      ok: true,
    };
    figma.ui.postMessage(reply);
  }
};
