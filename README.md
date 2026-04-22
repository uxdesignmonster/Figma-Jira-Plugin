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
│   ├── backend/
│   │   └── src/
│   │       ├── index.ts                Express app wiring
│   │       ├── auth/                   OAuth helpers (Atlassian)
│   │       ├── jira/
│   │       │   ├── client.ts           Jira REST client + token refresh
│   │       │   ├── errors.ts           Typed backend errors → error codes
│   │       │   ├── mapper.ts           Jira issue → JiraTicketSummary
│   │       │   ├── snapshotHash.ts     Stable hash over user-visible fields
│   │       │   ├── freshness.ts        Widget-link + snapshot lifecycle
│   │       │   └── webhooks.ts         Jira webhook payload → stale marking
│   │       ├── routes/
│   │       │   ├── auth.ts             /auth/* (OAuth start/callback/status)
│   │       │   ├── health.ts           /health
│   │       │   ├── issues.ts           /api/issues/*
│   │       │   ├── widgets.ts          /api/widgets/* (register/status/refresh)
│   │       │   └── webhooks.ts         /webhooks/jira
│   │       └── storage/                Token, OAuth-state, link, snapshot, dedup stores
│   └── figma-plugin/
│       ├── manifest.json               Single manifest declaring plugin + widget
│       └── src/
│           ├── code.tsx                Sandbox entry: widget registration, insert, link registration
│           ├── ui/                     React plugin UI (auth + search + insert)
│           └── widget/                 TicketWidget + shared sandbox constants
├── packages/
│   └── shared-types/                   Shared ticket type + contracts
├── package.json                        npm workspaces root
└── tsconfig.base.json                  shared compiler options
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

## Widget links + webhook-driven freshness (Phase 5)

From Phase 5 onwards the backend is the source of truth for "did this Jira
issue change since the widget last synced?". The plugin still does all the
actual rendering; the backend just answers `isStale` questions.

### Data model

| Store | Purpose |
| --- | --- |
| `WidgetLink` | One row per inserted widget. Keyed by a generated `linkId`; indexed by `(installationId, widgetNodeId)` and by `issueId`. Stores `lastSyncedAt`, `lastKnownIssueUpdatedAt`, `isStale`, plus `fileKey`/`fileName` when Figma exposes them. |
| `IssueSnapshot` | One row per Jira issue we've seen. Stores the last fetched `JiraTicketSummary` and a short `payloadHash` over user-visible fields (summary, status, assignee, updatedAt). |
| `WebhookDedupStore` | Short-lived set of webhook event ids (or synthetic ids) to shed Jira's at-least-once redeliveries. |

The widget identifier we persist is Figma's `WidgetNode.id` (the canvas node
id). This is stable per instance across sessions. Figma does not expose a
globally reliable user id, so we use our existing opaque `installationId`
(random hex stored in `figma.clientStorage`) as the per-user key.

### Backend endpoints added

| Endpoint | Purpose |
| --- | --- |
| `POST /api/widgets` | Register a newly inserted widget. Idempotent on `(installationId, widgetNodeId)`. Returns `WidgetLinkSummary`. |
| `GET /api/widgets/:linkId/status` | Cheap freshness check. Returns `WidgetLinkSummary` including `isStale`. |
| `POST /api/widgets/:linkId/refresh` | Re-fetches the issue via the link's installation, updates the snapshot, clears `isStale`, and returns `{ ticket, link }`. |
| `DELETE /api/widgets/:linkId` | Unregister. Not wired into the UI yet. |
| `POST /webhooks/jira` | Accepts Jira issue webhooks (`jira:issue_updated`, `jira:issue_created`, `jira:issue_deleted`). Deduplicates, updates the issue snapshot, and marks linked widgets stale if the hash changed. Always responds 200 so Atlassian doesn't retry. |

### Stale / fresh logic

Only three things mutate `isStale`:

1. **Register** (`POST /api/widgets`) writes `isStale: false` and refreshes the timestamps.
2. **Refresh** (`POST /api/widgets/:linkId/refresh`) writes `isStale: false` after a successful Jira fetch, and updates `lastSyncedAt` + `lastKnownIssueUpdatedAt`.
3. **Webhook** (`POST /webhooks/jira`) writes `isStale: true` on every matching link, but *only* when the webhook payload produces a different `payloadHash` than the snapshot we already have. Identical re-deliveries and no-op field changes (e.g. a field we don't render) are ignored.

The widget surfaces `isStale` in two places:
- A one-time `useEffect` fires `GET /api/widgets/:linkId/status` when the widget renders for the first time in a sandbox session. A module-level `Set` guards it so the effect firing on every rerender doesn't spam the backend.
- The refresh button prefers `POST /api/widgets/:linkId/refresh` so the stale flag clears atomically with the Jira fetch. If the widget has no `backendLinkId` (e.g. backend was down at insert time) it falls back to the original `GET /api/issues/:key` path.

### Jira webhook setup

In the Atlassian developer console for your OAuth app, add a webhook pointed at
`POST https://<your-backend>/webhooks/jira` and subscribe to the
`jira:issue_updated`, `jira:issue_created`, and `jira:issue_deleted` events for
the projects you care about. Webhook signature verification is not yet wired
up; for local testing, bind the backend only to localhost (or use a tunnel
like `ngrok http 4000`).

### Testing the freshness flow locally

1. Start the backend and plugin as in earlier phases; connect Jira in the plugin.
2. Insert a ticket from the plugin UI. Watch the backend log for `POST /api/widgets 201` — that confirms the link was registered and the widget got a `backendLinkId`.
3. Simulate a webhook: replace `YOUR_ISSUE_ID` / `YOUR_ISSUE_KEY` below.
   ```bash
   curl -X POST http://localhost:4000/webhooks/jira \
     -H "Content-Type: application/json" \
     -d '{
       "id": "evt-1",
       "webhookEvent": "jira:issue_updated",
       "timestamp": '"$(date +%s000)"',
       "issue": {
         "id": "YOUR_ISSUE_ID",
         "key": "YOUR_ISSUE_KEY",
         "self": "https://example.atlassian.net/rest/api/3/issue/YOUR_ISSUE_ID",
         "fields": {
           "summary": "New summary from webhook",
           "status": { "name": "In Progress" },
           "assignee": { "displayName": "Casey Example" },
           "updated": "'"$(date -u +%Y-%m-%dT%H:%M:%S.000%z)"'"
         }
       }
     }'
   ```
   Expect `{"ok":true,"result":{"status":"accepted","transitionedLinkIds":[...]}}`.
4. In Figma, deselect and re-select the widget (or click it to force a rerender). The "Updated in Jira · refresh to sync" pill appears. Re-sending the same curl returns `status: "duplicate"` and does nothing.
5. Click **Refresh** on the widget. The card updates, the stale pill disappears, and the backend log shows `POST /api/widgets/<linkId>/refresh`.

### Resilience + known limitations

- **Widget registration fails (backend down at insert time):** The widget is still placed and seeded with the ticket. The synced-state error slot shows `Backend unreachable …` once. `backendLinkId` stays `null`, so refresh falls back to the per-issue endpoint and staleness is unobservable for that widget. Re-inserting the ticket re-registers it.
- **Backend restarts:** All stores are in-memory, so links + snapshots are lost on restart. Existing widgets will see `link_not_found` on their next status check. The widget UI shows "Backend lost this widget's link. Reinsert to restore sync." — users must reinsert. Swapping `InMemory*Store` for persistent implementations closes this gap.
- **Webhook delivered for an issue with no linked widgets:** Snapshot is still updated so a future insertion for the same issue starts with a known baseline. `transitionedLinkIds` is `[]`.
- **Auth expired during refresh:** The existing `client.ts` path returns `reauth_required`; the widget translates it to "Jira session expired. Open the plugin to reconnect." Stale state is *not* cleared because the refresh did not succeed.
- **Duplicate webhook deliveries:** Handled by `WebhookDedupStore`; key is Atlassian's `id` when present, otherwise `${issueId}:${event}:${timestamp}`.
- **Widget duplication in Figma:** `WidgetNode.clone()` produces a node with the same `widgetId` but a *new* `node.id`. The cloned widget therefore has no backend link until the user refreshes it — and our refresh endpoints only work via `linkId`. Current behavior: the clone's synced state still carries the *original* widget's `backendLinkId`, so its **Refresh** button hits the original link (which clears its stale flag for both visually). This is documented rather than fixed in Phase 5; a follow-up could detect duplicated nodes in a `documentchange` handler and re-register on first interaction.
- **Webhook signature verification:** Not implemented. Treat `/webhooks/jira` as trusted only on localhost or behind a tunnel with access control until this is wired up.

## Status

Phase 5 complete: backend widget-link persistence, Jira webhook ingestion,
webhook-driven stale marking, widget freshness UI, and refresh-clears-stale
semantics. In-memory stores only — Postgres/Supabase implementations can slot
in behind the existing interfaces without touching routes or the freshness
service.
