import type { AppConfig } from "../config.js";

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

export type AccessibleResource = {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl?: string;
};

export type AtlassianMe = {
  account_id: string;
  email?: string;
  name?: string;
};

export class AtlassianApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export function buildAuthorizeUrl(
  config: AppConfig["jira"],
  state: string,
): string {
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: config.clientId,
    scope: config.scopes.join(" "),
    redirect_uri: config.redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  });
  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  config: AppConfig["jira"],
  code: string,
): Promise<TokenResponse> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!res.ok) {
    throw new AtlassianApiError(
      "Token exchange failed",
      res.status,
      await res.text(),
    );
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(
  config: AppConfig["jira"],
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new AtlassianApiError(
      "Token refresh failed",
      res.status,
      await res.text(),
    );
  }
  return (await res.json()) as TokenResponse;
}

export async function fetchAccessibleResources(
  config: AppConfig["jira"],
  accessToken: string,
): Promise<AccessibleResource[]> {
  const res = await fetch(
    `${config.apiBaseUrl}/oauth/token/accessible-resources`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new AtlassianApiError(
      "Failed to list accessible resources",
      res.status,
      await res.text(),
    );
  }
  return (await res.json()) as AccessibleResource[];
}

export async function fetchMe(
  config: AppConfig["jira"],
  accessToken: string,
): Promise<AtlassianMe> {
  const res = await fetch(`${config.apiBaseUrl}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new AtlassianApiError(
      "Failed to fetch current user",
      res.status,
      await res.text(),
    );
  }
  return (await res.json()) as AtlassianMe;
}
