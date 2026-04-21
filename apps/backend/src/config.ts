import "dotenv/config";

const REQUIRED_KEYS = [
  "JIRA_CLIENT_ID",
  "JIRA_CLIENT_SECRET",
  "JIRA_REDIRECT_URI",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

function required(key: RequiredKey): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `[config] Missing required env var: ${key}. Copy .env.example to .env and fill in Jira OAuth credentials.`,
    );
  }
  return value;
}

export type AppConfig = {
  port: number;
  jira: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    authorizeUrl: string;
    tokenUrl: string;
    apiBaseUrl: string;
  };
};

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 4000),
    jira: {
      clientId: required("JIRA_CLIENT_ID"),
      clientSecret: required("JIRA_CLIENT_SECRET"),
      redirectUri: required("JIRA_REDIRECT_URI"),
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
  };
}
