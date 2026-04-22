import express from "express";
import cors from "cors";
import { loadConfig } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { createIssuesRouter } from "./routes/issues.js";
import { createWidgetsRouter } from "./routes/widgets.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { OAuthStateStore } from "./storage/oauthStateStore.js";
import { WebhookDedupStore } from "./storage/webhookDedupStore.js";
import { buildStores } from "./storage/factory.js";
import { JiraClient } from "./jira/client.js";
import { FreshnessService } from "./jira/freshness.js";
import { WebhookProcessor } from "./jira/webhooks.js";

const config = loadConfig();
const stores = buildStores(config);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const stateStore = new OAuthStateStore();
// Dedup is kept in-memory on purpose: the TTL is short (minutes), writes are
// hot per delivery, and a restart-time reprocess just re-marks widgets stale
// — which is already idempotent. Moving this to Postgres would trade a row
// per delivery for a corner case that has no user-visible effect.
const webhookDedup = new WebhookDedupStore();
const jiraClient = new JiraClient(config, stores.tokens);
const freshness = new FreshnessService({
  links: stores.links,
  snapshots: stores.snapshots,
  jira: jiraClient,
});
const webhookProcessor = new WebhookProcessor({
  freshness,
  dedup: webhookDedup,
});

app.use("/health", healthRouter);
app.use(
  "/auth",
  createAuthRouter({ config, tokenStore: stores.tokens, stateStore }),
);
app.use("/api/issues", createIssuesRouter({ jiraClient }));
app.use("/api/widgets", createWidgetsRouter({ freshness }));
app.use(
  "/webhooks",
  createWebhooksRouter({
    processor: webhookProcessor,
    webhookSecret: config.webhook.secret,
  }),
);

const server = app.listen(config.port, () => {
  console.log(`[backend] listening on http://localhost:${config.port}`);
  console.log(`[backend] jira redirect uri: ${config.jira.redirectUri}`);
  console.log(`[backend] public base url: ${config.publicBaseUrl}`);
  console.log(
    `[backend] storage: ${stores.pool ? "postgres" : "in-memory (dev)"}`,
  );
  if (config.webhook.secret) {
    const hint = `${config.publicBaseUrl}/webhooks/jira/<JIRA_WEBHOOK_SECRET>`;
    console.log(`[backend] webhook URL (register in Jira): ${hint}`);
  }
});

// Graceful shutdown so deploys don't leak pool connections.
async function shutdown(signal: string): Promise<void> {
  console.log(`[backend] ${signal} received, closing…`);
  server.close();
  if (stores.pool) await stores.pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
