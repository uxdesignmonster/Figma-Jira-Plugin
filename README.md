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
npm run dev:backend   # http://localhost:4000/health
npm run dev:plugin    # builds plugin + UI in watch mode
npm run dev:widget    # builds widget in watch mode
```

Then load `apps/figma-plugin/manifest.json` and `apps/figma-widget/manifest.json` in Figma via **Plugins → Development → Import from manifest**.

## Status

Phase 0 — scaffolding only. Next phases: Jira OAuth, issue fetching, plugin UI flows, widget integration.
