# Figma + Jira Integration

Private internal tool that lets a designer place Jira tickets onto the Figma canvas and keep them in sync.

## Architecture

Two apps in an npm workspace monorepo:

| App | Purpose |
| --- | --- |
| `apps/figma-plugin` | Combined Figma plugin + widget: React UI for auth/search and a canvas `TicketWidget` for placed tickets |
| `apps/backend` | Node/Express backend. Owns Jira OAuth tokens, fetches issues, (later) handles webhooks |

Shared TypeScript types live in `packages/shared-types`.

### Why plugin + widget share one manifest

`figma.createNodeFromJSXAsync(<TicketWidget />)` and `WidgetNode.setWidgetSyncedState(...)` are only allowed when the calling sandbox's `figma.widgetId` matches the target widget — in other words, the widget must be registered in the _same_ manifest as the plugin that's inserting it. A separate widget workspace would have prevented the plugin from seeding a newly inserted widget with ticket data, so the two are bundled under a single manifest that declares both `api` and `widgetApi` and sets `containsWidget: true`.

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
│   ├── backend/                Express server (Jira OAuth + API proxy)
│   └── figma-plugin/
│       ├── manifest.json       Single manifest declaring plugin + widget
│       └── src/
│           ├── code.tsx        Sandbox entry: registers widget, handles menu command
│           ├── ui/             React plugin UI (auth + search + insert)
│           └── widget/         TicketWidget + shared sandbox constants
├── packages/
│   └── shared-types/           Shared ticket type + contracts
├── package.json                npm workspaces root
└── tsconfig.base.json          shared compiler options
```

The plugin workspace has two tsconfigs because the two surfaces use different JSX factories:

- `tsconfig.json` — React UI in `src/ui/**` (`jsx: react-jsx`).
- `tsconfig.sandbox.json` — sandbox + widget in `src/code.tsx` and `src/widget/**` (`jsx: react` with `jsxFactory: figma.widget.h`).

## Getting started

```bash
npm install
cp apps/backend/.env.example apps/backend/.env   # fill in Jira creds
npm run dev:backend   # http://localhost:4000/health
npm run dev:plugin    # builds sandbox + UI in watch mode
```

Then load `apps/figma-plugin/manifest.json` in Figma via **Plugins → Development → Import from manifest**. The same manifest registers the plugin menu command (Insert Jira ticket) and the `TicketWidget` you can drop on the canvas.

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

## Jira issue API (Phase 3)

The backend exposes two authenticated endpoints for the plugin:

| Endpoint | Returns |
| --- | --- |
| `GET /api/issues/search?installationId=…&q=…` | `SearchIssuesResponse` — up to 20 `JiraTicketSummary` results, exact issue-key matches prepended |
| `GET /api/issues/:issueKey?installationId=…` | `GetIssueResponse` — a single `JiraTicketSummary` |

Both return the shared envelope `{ ok: true, … } | { ok: false, error: { code, message } }`. Error codes: `unauthenticated`, `reauth_required`, `not_found`, `upstream_error`, `bad_request`.

Token handling is centralized in `apps/backend/src/jira/client.ts`:

- Refreshes access tokens proactively when within 60s of expiry.
- Retries once on a 401 response with a refreshed token.
- Surfaces `reauth_required` (and drops the stored connection) when the refresh token itself is rejected.

The plugin's **Reconnect Jira** button on an auth error loops the user back through the OAuth flow.

### Testing the search flow locally

1. Complete Phase 2 auth so the plugin is connected.
2. Type at least 2 characters into the search input — results appear after a 300ms debounce.
3. Paste an issue key like `ABC-123` to jump straight to that ticket (exact match is prepended to results).
4. Click a row to select it. The **Selected** panel appears with an active **Insert ticket on canvas** button (Phase 4).
5. Force a reauth path by revoking the OAuth grant in Atlassian (User menu → Settings → Connected apps) and searching again — the UI should show **Reconnect Jira**.

## Widget insertion + refresh (Phase 4)

When a ticket is selected and the user clicks **Insert ticket on canvas**, the plugin UI posts `{ type: "insert-widget", ticket }` to the sandbox (`code.tsx`). The sandbox:

1. Calls `figma.createNodeFromJSXAsync(<TicketWidget />)` to materialise a `WidgetNode`.
2. Seeds it via `WidgetNode.setWidgetSyncedState(...)` with `ticket`, `lastSyncedAt`, `isLoading`, `error`.
3. Centers it on the current viewport, selects it, and scrolls it into view.

The widget reads the synced state and renders the ticket card. A **Refresh** button re-fetches the ticket from `GET /api/issues/:issueKey` (using the `installationId` stored in `figma.clientStorage`) and rewrites the synced state. Token refresh, reauth detection, and `not_found` handling are all delegated to the backend — the widget never talks to Jira directly.

### Testing the insertion flow locally

1. Search for and select an issue.
2. Click **Insert ticket on canvas** — a confirmation appears below the button and the widget is placed in the viewport.
3. Click the widget's **Refresh** chip to re-pull the ticket via the backend. The relative timestamp updates.
4. Revoke the OAuth grant, then click **Refresh** — the widget displays a friendly "reconnect" message pulled from the backend's `reauth_required` error code.

## Status

Phase 4 complete: plugin + widget merged under one manifest, programmatic widget insertion with pre-seeded synced state, canvas ticket card with manual refresh.
