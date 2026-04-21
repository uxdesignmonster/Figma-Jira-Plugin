import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import type { TokenStore } from "../storage/tokenStore.js";
import type { OAuthStateStore } from "../storage/oauthStateStore.js";
import {
  AtlassianApiError,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchAccessibleResources,
  fetchMe,
} from "../auth/atlassian.js";

type Deps = {
  config: AppConfig;
  tokenStore: TokenStore;
  stateStore: OAuthStateStore;
};

function getQueryParam(req: Request, name: string): string | null {
  const value = req.query[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createAuthRouter(deps: Deps): Router {
  const { config, tokenStore, stateStore } = deps;
  const router = Router();

  // Kick off OAuth. Plugin UI opens this URL via figma.openExternal; the
  // browser takes the redirect to Atlassian.
  router.get("/jira/start", (req, res) => {
    const installationId = getQueryParam(req, "installationId");
    if (!installationId) {
      res.status(400).send("Missing installationId");
      return;
    }
    const state = stateStore.create(installationId);
    res.redirect(buildAuthorizeUrl(config.jira, state));
  });

  // OAuth callback (hit by the user's browser after Atlassian consent).
  router.get("/jira/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const errorParam = getQueryParam(req, "error");

    if (errorParam) {
      res.status(400).send(renderErrorPage(`Atlassian returned: ${errorParam}`));
      return;
    }
    if (!code || !state) {
      res.status(400).send(renderErrorPage("Missing code or state."));
      return;
    }

    const installationId = stateStore.consume(state);
    if (!installationId) {
      res.status(400).send(renderErrorPage("Invalid or expired state."));
      return;
    }

    try {
      const token = await exchangeCodeForToken(config.jira, code);
      const [resources, me] = await Promise.all([
        fetchAccessibleResources(config.jira, token.access_token),
        fetchMe(config.jira, token.access_token).catch(() => null),
      ]);

      const site = resources[0];
      if (!site) {
        res
          .status(400)
          .send(
            renderErrorPage(
              "No Jira sites are accessible for this account. Ask an admin to grant access, then try again.",
            ),
          );
        return;
      }

      await tokenStore.save({
        installationId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
        site: {
          cloudId: site.id,
          url: site.url,
          name: site.name,
          scopes: site.scopes,
          avatarUrl: site.avatarUrl,
        },
        account: {
          accountId: me?.account_id ?? "",
          email: me?.email,
          displayName: me?.name,
        },
        connectedAt: Date.now(),
      });

      res.send(renderSuccessPage(site.name));
    } catch (err) {
      const message =
        err instanceof AtlassianApiError
          ? `${err.message} (status ${err.status})`
          : "Unexpected error completing auth.";
      console.error("[auth/callback] failed:", err);
      res.status(500).send(renderErrorPage(message));
    }
  });

  // Plugin UI polls this to discover whether auth completed.
  router.get("/status", async (req, res) => {
    const installationId = getQueryParam(req, "installationId");
    if (!installationId) {
      res.status(400).json({ ok: false, error: "Missing installationId" });
      return;
    }
    const conn = await tokenStore.load(installationId);
    if (!conn) {
      res.json({ connected: false });
      return;
    }
    res.json({
      connected: true,
      site: {
        cloudId: conn.site.cloudId,
        url: conn.site.url,
        name: conn.site.name,
      },
      account: {
        accountId: conn.account.accountId,
        email: conn.account.email,
        displayName: conn.account.displayName,
      },
      connectedAt: conn.connectedAt,
    });
  });

  router.post("/disconnect", async (req, res) => {
    const installationId =
      (req.body && typeof req.body.installationId === "string"
        ? req.body.installationId
        : null) ?? getQueryParam(req, "installationId");
    if (!installationId) {
      res.status(400).json({ ok: false, error: "Missing installationId" });
      return;
    }
    await tokenStore.delete(installationId);
    // Note: not calling Atlassian's revoke endpoint yet — tokens will expire
    // on their own. Add revoke in a later phase if needed.
    res.json({ ok: true });
  });

  return router;
}

function renderSuccessPage(siteName: string): string {
  const safe = escapeHtml(siteName);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title>
<style>
  body { font: 14px system-ui, sans-serif; color: #111; padding: 40px; max-width: 480px; margin: 0 auto; }
  h1 { font-size: 18px; }
  p { color: #555; }
</style></head>
<body>
  <h1>Connected to ${safe}</h1>
  <p>You can close this tab and return to Figma.</p>
</body></html>`;
}

function renderErrorPage(message: string): string {
  const safe = escapeHtml(message);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Auth error</title>
<style>
  body { font: 14px system-ui, sans-serif; color: #111; padding: 40px; max-width: 480px; margin: 0 auto; }
  h1 { font-size: 18px; color: #B00020; }
  p { color: #555; }
</style></head>
<body>
  <h1>Couldn't connect Jira</h1>
  <p>${safe}</p>
  <p>Return to Figma and try again.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
