# Figma + Jira Integration

Private internal tool that lets a designer place Jira tickets onto the Figma canvas and keep them in sync.

## Architecture

Three apps in an npm workspace monorepo:

| App | Purpose |
| --- | --- |
| `apps/figma-widget` | Widget that renders the persistent ticket card on the canvas |
| `apps/figma-plugin` | Plugin UI (React) for auth + issue search + widget insertion |
| `apps/backend` | Node/Express backend. Owns Jira OAuth tokens, fetches issues, (later) handles webhooks |

Shared TypeScript types live in `packages/shared-types`.

### Data flow (MVP)

1. User runs the plugin inside Figma.
2. Plugin UI talks to the backend (OAuth + issue search).
3. Plugin inserts the widget on the canvas with a `JiraTicketSummary` payload.
4. Widget stores the payload in synced state and renders the card.
5. Refresh button in the widget re-fetches via the backend.

Tokens are **only** stored on the backend. Figma never sees a Jira token.

## Project layout

```
/
├── apps/
│   ├── backend/        Express server (Jira OAuth + API proxy)
│   ├── figma-plugin/   Figma plugin (code.ts sandbox + React UI)
│   └── figma-widget/   Figma widget (widget.tsx)
├── packages/
│   └── shared-types/   Shared ticket type + contracts
├── package.json        npm workspaces root
└── tsconfig.base.json  shared compiler options
```

## Getting started

```bash
npm install
cp apps/backend/.env.example apps/backend/.env   # fill in Jira creds
npm run dev:backend   # http://localhost:4000/health
npm run dev:plugin    # builds plugin + UI in watch mode
npm run dev:widget    # builds widget in watch mode
```

Then load `apps/figma-plugin/manifest.json` and `apps/figma-widget/manifest.json` in Figma via **Plugins → Development → Import from manifest**.

## Jira OAuth setup (Phase 2)

1. Go to <https://developer.atlassian.com/console/myapps/> and create an "OAuth 2.0 integration" app.
2. Under **Permissions**, add the Jira platform REST API and request the scopes:
   `read:me`, `read:jira-user`, `read:jira-work`, `offline_access`.
3. Under **Authorization**, set the callback URL to match `JIRA_REDIRECT_URI` below (default `http://localhost:4000/auth/jira/callback`).
4. Copy the client id + secret into `apps/backend/.env`.

### Required environment variables (backend)

| Var | Required | Notes |
| --- | --- | --- |
| `PORT` | no | Defaults to `4000`. |
| `JIRA_CLIENT_ID` | **yes** | From your Atlassian OAuth app. |
| `JIRA_CLIENT_SECRET` | **yes** | From your Atlassian OAuth app. |
| `JIRA_REDIRECT_URI` | **yes** | Must match the callback URL registered in Atlassian. Default: `http://localhost:4000/auth/jira/callback`. |
| `DATABASE_URL` | no | Unused in Phase 2 (tokens live in-memory). Reserved for the Postgres `TokenStore` in Phase 3+. |

### Running the auth flow locally

1. Start the backend (`npm run dev:backend`) and confirm `GET /health` returns OK.
2. Open the plugin in Figma (Plugins → Development → Import from manifest → `apps/figma-plugin/manifest.json`).
3. Click **Connect Jira**. A browser tab opens at `/auth/jira/start`, which redirects you to Atlassian.
4. Approve the scopes. Atlassian redirects back to `/auth/jira/callback`, which exchanges the code, saves the tokens + site info, and shows a "Connected" confirmation page.
5. Back in the plugin, the UI polls `/auth/status` and switches to the connected view automatically.
6. **Disconnect** clears the tokens on the backend.

## Status

Phase 2 complete: Jira OAuth 3LO + plugin connection flow. Tokens stored only on the backend (in-memory for now; swap to Postgres via `TokenStore`).

Next phases: issue search endpoint, get-issue-by-key, plugin search UI; then widget insertion; then webhooks.
