# M15-AUDIT

Accounting and audit management platform for Ivorian accounting firms — financial analysis, payroll, multi-station dashboards, DSF, audit trails, and client management.

## Run & Operate

- Workflows start automatically: `artifacts/m15-audit: web` (frontend) and `artifacts/api-server: API Server` (backend)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm run typecheck` — full typecheck across all packages
- Required secrets: `SESSION_SECRET` (JWT signing key — already set)
- Optional secrets: `RESEND_API_KEY` (email sending via Resend), `SMTP_FROM` (sender address)
- `DATABASE_URL` is runtime-managed by Replit

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7 + Tailwind CSS v4 + shadcn/ui + wouter routing
- API: Express 5 + pino logging + JWT auth + WebSocket realtime (`/api/ws`)
- DB: PostgreSQL + Drizzle ORM (`lib/db/src/schema/`)
- Validation: Zod, `drizzle-zod`, generated Zod schemas in `lib/api-zod/`
- API codegen: Orval (from `lib/api-spec/openapi.yaml`)
- Build: esbuild (ESM bundle for API server)
- Email: Resend (`RESEND_API_KEY` — optional, logs emails when missing)

## Where things live

- `artifacts/m15-audit/src/` — React frontend (pages, components, hooks)
- `artifacts/m15-audit/src/index.css` — design tokens (colors, fonts, radius)
- `artifacts/api-server/src/routes/` — ~30 Express route files by domain
- `artifacts/api-server/src/lib/` — business logic engines (accounting, payroll, audit, reporting)
- `lib/db/src/schema/` — Drizzle table definitions (source of truth for DB)
- `lib/db/drizzle/` — migration SQL files
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated Zod validation schemas
- `attached_assets/` — images and brand assets (logo, hero photos)
- `scripts/` — admin utilities (seed super-admin, update super-admin)

## Architecture decisions

- **Startup migrations**: The API server runs Drizzle's `migrate()` at startup using SQL files from `lib/db/drizzle/`. The migration tracking table lives in schema `drizzle.__drizzle_migrations` with a SHA256 hash of the SQL content as the key.
- **Drizzle push for dev setup**: On first dev setup, run `pnpm --filter @workspace/db run push` to create tables, then manually seed the `drizzle.__drizzle_migrations` table with the correct SHA256 hash so the server's startup migrator skips already-applied migrations.
- **CORS**: Wildcard in dev (no `CORS_ORIGIN` env set); set `CORS_ORIGIN` to comma-separated frontend URLs for production.
- **API routing**: All API paths route through the shared proxy at `/api`. Frontend uses relative `/api/...` URLs.
- **WebSocket**: Realtime at `/api/ws` — listed in `artifact.toml` paths so the proxy forwards upgrade requests.

## Product

M15-AUDIT is a SaaS platform for Ivorian accounting and audit firms. Key modules:
- **Authentication** — JWT-based multi-firm login, trial/subscription tiers
- **Comptabilité** — general ledger, journal entries, closing, VAT (DSF)
- **Stations** — multi-station fuel/retail management, pump shifts, caisse express
- **Paie** — payroll engine, DSF declarations
- **Immobilisations** — fixed asset register
- **Rapports** — financial statements, cabinet analytics
- **Missions** — audit engagement tracking
- **Collaboration** — real-time comments/notifications via WebSocket

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Do not run `pnpm dev` at workspace root** — artifacts run via their managed workflows.
- **After `drizzle-kit push` on a fresh DB**, seed `drizzle.__drizzle_migrations` with the SHA256 of the migration SQL so the server startup migrator doesn't re-run. Current hash: `f107e607a38332f386706817df820c144fba95ade83a2682d5edfffaa502c47f`
- **`zod/v4` subpath**: Some route files originally used `import { z } from "zod/v4"` — patched to `import { z } from "zod"` (same API in v3.x). Do not re-introduce `zod/v4` imports in api-server routes.
- **API server direct dependencies**: If a route file imports a package directly, it must be in `artifacts/api-server/package.json` `dependencies` (not inherited from a lib workspace package).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
