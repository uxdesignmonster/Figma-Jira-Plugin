import express from "express";
import cors from "cors";
import { loadConfig } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { createIssuesRouter } from "./routes/issues.js";
import { createWidgetsRouter } from "./routes/widgets.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { InMemoryTokenStore } from "./storage/tokenStore.js";
import { OAuthStateStore } from "./storage/oauthStateStore.js";
import { InMemoryWidgetLinkStore } from "./storage/widgetLinkStore.js";
import { InMemoryIssueSnapshotStore } from "./storage/issueSnapshotStore.js";
import { WebhookDedupStore } from "./storage/webhookDedupStore.js";
import { JiraClient } from "./jira/client.js";
import { FreshnessService } from "./jira/freshness.js";
import { WebhookProcessor } from "./jira/webhooks.js";

const config = loadConfig();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const tokenStore = new InMemoryTokenStore();
const stateStore = new OAuthStateStore();
const linkStore = new InMemoryWidgetLinkStore();
const snapshotStore = new InMemoryIssueSnapshotStore();
const webhookDedup = new WebhookDedupStore();
const jiraClient = new JiraClient(config, tokenStore);
const freshness = new FreshnessService({
  links: linkStore,
  snapshots: snapshotStore,
  jira: jiraClient,
});
const webhookProcessor = new WebhookProcessor({
  freshness,
  dedup: webhookDedup,
});

app.use("/health", healthRouter);
app.use("/auth", createAuthRouter({ config, tokenStore, stateStore }));
app.use("/api/issues", createIssuesRouter({ jiraClient }));
app.use("/api/widgets", createWidgetsRouter({ freshness }));
app.use("/webhooks", createWebhooksRouter({ processor: webhookProcessor }));

app.listen(config.port, () => {
  console.log(`[backend] listening on http://localhost:${config.port}`);
  console.log(`[backend] jira redirect uri: ${config.jira.redirectUri}`);
});
