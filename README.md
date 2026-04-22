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

## Getting started (local)

```bash
# 1. Install deps
npm install

# 2. Provision Postgres (first time only)
createdb figma_jira_dev                                # or any method you prefer
cp apps/backend/.env.example apps/backend/.env         # fill in Jira creds + DATABASE_URL

# 3. Run migrations
npm run db:migrate --workspace apps/backend

# 4. Run everything
npm run dev:backend   # http://localhost:4000/health
npm run dev:plugin    # builds sandbox + UI in watch mode
```

You can skip Postgres for very quick prototyping — unset `DATABASE_URL` and the backend falls back to in-memory stores with a warning. Production (`NODE_ENV=production`) requires `DATABASE_URL` and `JIRA_WEBHOOK_SECRET` at startup.

Then load `apps/figma-plugin/manifest.json` in Figma via **Plugins → Development → Import from manifest**. The same manifest registers the plugin menu command (Insert Jira ticket) and the `TicketWidget` you can drop on the canvas.

## Jira OAuth setup (Phase 2)

1. Go to <https://developer.atlassian.com/console/myapps/> and create an "OAuth 2.0 integration" app.
2. Under **Permissions**, add the Jira platform REST API and request the scopes:
   `read:me`, `read:jira-user`, `read:jira-work`, `offline_access`.
3. Under **Authorization**, set the callback URL to match `JIRA_REDIRECT_URI` below (default `http://localhost:4000/auth/jira/callback`).
4. Copy the client id + secret into `apps/backend/.env`.

### Required environment variables (backend)

See `apps/backend/.env.example` for annotated defaults.

| Var | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | no | `development` (default) or `production`. Production enforces DB + webhook secret. |
| `PORT` | no | Defaults to `4000`. |
| `PUBLIC_BASE_URL` | no | Public origin of the backend (e.g. `https://example.com`). Used in startup logs for the webhook URL. |
| `JIRA_CLIENT_ID` | **yes** | From your Atlassian OAuth app. |
| `JIRA_CLIENT_SECRET` | **yes** | From your Atlassian OAuth app. |
| `JIRA_REDIRECT_URI` | **yes** | Must match the callback URL registered in Atlassian. Default: `http://localhost:4000/auth/jira/callback`. |
| `DATABASE_URL` | **yes in prod** | Postgres connection string. SSL is auto-enabled for managed-Postgres hosts. In dev, unset = in-memory stores. |
| `JIRA_WEBHOOK_SECRET` | **yes in prod** | Unguessable string embedded as a path segment on the webhook URL. See § Webhook security. |

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

## Durability + security (Phase 6)

### Persistent storage (Postgres)

All Phase 5 stores are now behind `TokenStore`, `WidgetLinkStore`, and
`IssueSnapshotStore` interfaces with both **in-memory** (dev) and
**Postgres** (production) implementations selected by `storage/factory.ts`.
Webhook dedup stays in-memory by design — its TTL is short, a restart at
worst re-marks widgets stale (idempotent), and persisting every delivery
would be wasteful.

Schema lives in `apps/backend/migrations/*.sql` and is applied with:

```bash
npm run db:migrate --workspace apps/backend
```

The runner (`src/db/migrate.ts`) tracks applied files in a `_migrations`
table and runs each file in a transaction, so it's safe to rerun on every
deploy.

| Table | Key columns | Purpose |
| --- | --- | --- |
| `jira_connections` | PK `installation_id` | OAuth tokens + site + account |
| `widget_links` | PK `link_id`, UNIQUE `(installation_id, widget_node_id)`, INDEX `issue_id`/`issue_key` | One row per inserted widget instance |
| `issue_snapshots` | PK `issue_id`, INDEX `issue_key` | Last-known issue content + payload hash |
| `_migrations` | PK `name` | Migration bookkeeping |

Managed Postgres URLs (Neon, Supabase, Render, Railway, RDS) auto-enable
SSL. Append `?sslmode=disable` to force off.

### Webhook security

Jira Cloud OAuth-app webhooks do not offer HMAC signing, so signature
verification isn't an option. The trust anchor is an unguessable URL:

```
POST ${PUBLIC_BASE_URL}/webhooks/jira/${JIRA_WEBHOOK_SECRET}
```

`JIRA_WEBHOOK_SECRET` is compared with `timingSafeEqual`, and a wrong/
missing secret returns an opaque `404` so scanners can't distinguish a
valid-URL shape from an invalid one. The route also rejects non-object
payloads and enforces a 1 MB JSON body limit.

**Recommended production setup:**
- Terminate TLS at a reverse proxy or PaaS; never expose plain HTTP.
- Optional defence in depth: allowlist Atlassian's published webhook IP
  ranges at the proxy layer.
- Rotate `JIRA_WEBHOOK_SECRET` by updating the registered webhook URL in
  Jira and restarting the backend.
- Production startup (`NODE_ENV=production`) refuses to boot without
  `JIRA_WEBHOOK_SECRET`.

### Widget duplication

Every register-time call now records the node id the link was created for
in synced state (`registeredNodeId`). On every render the widget compares
`useWidgetNodeId()` against that value:

- **Match:** normal mode — freshness check runs, refresh uses the link.
- **Mismatch (a clone):** the widget clears the carried-over
  `backendLinkId` and `registeredNodeId` immediately, shows a
  "Not linked to backend · reconnect to track Jira changes" pill, and
  renames its primary action to **Reconnect ticket**. Clicking it calls
  `POST /api/widgets` with the current ticket and the clone's real node id,
  producing a fresh link record.

Cloned widgets therefore never permanently masquerade as the original.
The only time the clone-vs-original stays ambiguous is the window between
clone creation and the next render — which fires automatically in Figma
well before any user interaction.

### Link recovery

When any server call returns `link_not_found` (deleted link, restored
database, etc.), the widget drops the stored `backendLinkId` and falls
through to the same **Reconnect ticket** path as the clone case. The
ticket data itself is preserved from synced state, so the user never sees
a blank card.

### Testing locally

**Normal insert + refresh**

1. Start backend (`npm run dev:backend`) and plugin (`npm run dev:plugin`).
2. Connect Jira in the plugin, search, click **Insert ticket on canvas**.
3. Backend log shows `POST /api/widgets → 201` and `storage: postgres`.
4. Click **Refresh** on the widget; `lastSyncedAt` bumps.

**Stale + webhook**

```bash
# Replace ISSUE_ID / ISSUE_KEY with the ticket you inserted:
curl -X POST "http://localhost:4000/webhooks/jira/$JIRA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt-1",
    "webhookEvent": "jira:issue_updated",
    "timestamp": '"$(date +%s000)"',
    "issue": {
      "id": "ISSUE_ID",
      "key": "ISSUE_KEY",
      "self": "https://example.atlassian.net/rest/api/3/issue/ISSUE_ID",
      "fields": {
        "summary": "New summary",
        "status": { "name": "In Progress" },
        "assignee": { "displayName": "Casey" },
        "updated": "'"$(date -u +%Y-%m-%dT%H:%M:%S.000%z)"'"
      }
    }
  }'
```
- Expect `status: "accepted"` and `transitionedLinkIds` listing your link.
- Re-send the same request → `status: "duplicate"`.
- Wrong secret → `404`.
- In Figma, click the widget (triggers a rerender); the "Updated in Jira"
  pill appears. Click **Refresh** — pill clears, card updates.

**Backend restart persistence**

1. Insert a widget. Note the `linkId` from the backend log.
2. `Ctrl+C` the backend, then start it again.
3. In Figma, click the widget — the mount effect hits
   `GET /api/widgets/:linkId/status` and gets back the *same* link. No
   reinsert required.
4. Disable Postgres (`DATABASE_URL=` empty) and repeat — the widget gets
   `link_not_found` on the next check, drops the link id, and shows
   **Reconnect ticket**. Clicking Reconnect produces a new link.

**Duplicate widget**

1. Right-click the canvas widget → **Duplicate** (or `Cmd/Ctrl+D`).
2. The clone renders with a **Not linked to backend** pill and a
   **Reconnect ticket** action (its own `useWidgetNodeId()` no longer
   matches the synced `registeredNodeId`).
3. Click **Reconnect ticket** → a new link row appears in `widget_links`;
   the clone now tracks staleness independently of the original.

**Broken link recovery**

```bash
# Delete a link row directly:
psql "$DATABASE_URL" -c "DELETE FROM widget_links WHERE link_id='LINK_ID';"
```
In Figma, interact with the widget. It detects `link_not_found`, drops
`backendLinkId`, and shows **Reconnect ticket** — clicking it re-creates
the link.

### Remaining limitations

- **Webhook signature verification** is impossible on Jira Cloud OAuth-app
  webhooks. The URL-secret + optional IP allowlist is the best we can do
  without Atlassian adding signed payloads.
- **Clone detection window.** Between clone creation and first render,
  the clone technically holds the original's `backendLinkId`. No network
  call happens in that window, so nothing changes on the backend — but
  code that reads synced state without rendering could be misled. None of
  our code does that.
- **`figma.fileKey` is undefined** in Figma draft files. We store `null`
  rather than fabricating one. `fileKey` is informational only today.
- **Token revocation.** Disconnect clears the backend row but doesn't yet
  call Atlassian's revoke endpoint. Low-priority — tokens still expire.

## Status

Phase 6 complete: Postgres-backed persistence with migrations, URL-secret
webhook security with constant-time comparison, clone detection via
`useWidgetNodeId()`, and a **Reconnect ticket** recovery path that covers
both clones and backend-lost links. Production startup requires
`DATABASE_URL` and `JIRA_WEBHOOK_SECRET`; dev mode still works with
in-memory stores and an open webhook endpoint (with a loud warning).
