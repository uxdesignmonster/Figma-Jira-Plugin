import "dotenv/config";

type RawEnv = NodeJS.ProcessEnv;

export type AppConfig = {
  env: "development" | "production" | "test";
  port: number;
  publicBaseUrl: string;
  jira: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    authorizeUrl: string;
    tokenUrl: string;
    apiBaseUrl: string;
  };
  database: {
    url: string | null;
  };
  webhook: {
    secret: string | null;
  };
};

/**
 * Loads + validates configuration. Designed to fail loudly on startup rather
 * than silently half-work: missing required env vars throw, production-mode
 * soft defaults throw, and optional-but-recommended settings log a warning.
 */
export function loadConfig(env: RawEnv = process.env): AppConfig {
  const nodeEnv = coerceNodeEnv(env.NODE_ENV);
  const port = parsePort(env.PORT);
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(
    /\/$/,
    "",
  );

  const clientId = requireEnv(env, "JIRA_CLIENT_ID");
  const clientSecret = requireEnv(env, "JIRA_CLIENT_SECRET");
  const redirectUri = requireEnv(env, "JIRA_REDIRECT_URI");

  const databaseUrl = optionalEnv(env, "DATABASE_URL");
  if (nodeEnv === "production" && !databaseUrl) {
    throw new Error(
      "[config] DATABASE_URL is required in production (in-memory stores are dev-only).",
    );
  }
  if (!databaseUrl) {
    console.warn(
      "[config] DATABASE_URL not set — using in-memory stores. State is lost on restart. Set DATABASE_URL for persistence.",
    );
  }

  const webhookSecret = optionalEnv(env, "JIRA_WEBHOOK_SECRET");
  if (nodeEnv === "production" && !webhookSecret) {
    throw new Error(
      "[config] JIRA_WEBHOOK_SECRET is required in production. See README § Webhook security.",
    );
  }
  if (!webhookSecret) {
    console.warn(
      "[config] JIRA_WEBHOOK_SECRET not set — /webhooks/jira/:secret is open in dev mode. DO NOT expose this port publicly without a tunnel + ACL.",
    );
  }

  return {
    env: nodeEnv,
    port,
    publicBaseUrl,
    jira: {
      clientId,
      clientSecret,
      redirectUri,
      // Minimum read-only scopes. `offline_access` is required for refresh tokens.
      scopes: [
        "read:me",
        "read:jira-user",
        "read:jira-work",
        "offline_access",
      ],
      authorizeUrl: "https://auth.atlassian.com/authorize",
      tokenUrl: "https://auth.atlassian.com/oauth/token",
      apiBaseUrl: "https://api.atlassian.com",
    },
    database: { url: databaseUrl },
    webhook: { secret: webhookSecret },
  };
}

function coerceNodeEnv(raw: string | undefined): AppConfig["env"] {
  if (raw === "production" || raw === "test") return raw;
  return "development";
}

function parsePort(raw: string | undefined): number {
  const n = Number(raw ?? 4000);
  if (!Number.isFinite(n) || n <= 0 || n >= 65536) {
    throw new Error(`[config] Invalid PORT: ${raw}`);
  }
  return n;
}

function requireEnv(env: RawEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `[config] Missing required env var: ${key}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optionalEnv(env: RawEnv, key: string): string | null {
  const value = env[key];
  return value && value.trim() !== "" ? value : null;
}
