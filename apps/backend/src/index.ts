import express from "express";
import cors from "cors";
import { loadConfig } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { createIssuesRouter } from "./routes/issues.js";
import { InMemoryTokenStore } from "./storage/tokenStore.js";
import { OAuthStateStore } from "./storage/oauthStateStore.js";
import { JiraClient } from "./jira/client.js";

const config = loadConfig();

const app = express();
app.use(cors());
app.use(express.json());

const tokenStore = new InMemoryTokenStore();
const stateStore = new OAuthStateStore();
const jiraClient = new JiraClient(config, tokenStore);

app.use("/health", healthRouter);
app.use("/auth", createAuthRouter({ config, tokenStore, stateStore }));
app.use("/api/issues", createIssuesRouter({ jiraClient }));

app.listen(config.port, () => {
  console.log(`[backend] listening on http://localhost:${config.port}`);
  console.log(`[backend] jira redirect uri: ${config.jira.redirectUri}`);
});
