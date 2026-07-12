# M15-AUDIT

M15-AUDIT is a SaaS platform that digitizes accounting workflows and the SYSCOHADA visa process for accounting firms (cabinets d'expertise-comptable) in French-speaking Africa.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (artifact `api-server`, preview `/api`)
- `pnpm --filter @workspace/m15-audit run dev` — run the frontend (artifact `m15-audit`, preview `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (`lib/api-spec/openapi.yaml`)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (provisioned). `SESSION_SECRET` is reused as the JWT signing secret.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`)
- Frontend: React + Vite + Tailwind + shadcn/ui, wouter router, React Query (`artifacts/m15-audit`)
- DB: PostgreSQL + Drizzle ORM (`lib/db`), multi-tenant via a `firmId` column on every domain table
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec) → React Query hooks (`lib/api-client-react`) + Zod schemas (`lib/api-zod`)
- Auth: custom JWT (bcryptjs + jsonwebtoken), RBAC via `requireRole` middleware
- Build: esbuild (ESM bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for the API contract
- `lib/db/src/schema/` — Drizzle table + relation definitions (firms, users, clients, missions, checklist_items, documents, audit_logs)
- `artifacts/api-server/src/routes/` — Express route handlers, one file per resource
- `artifacts/api-server/src/lib/visa-engine.ts` — SYSCOHADA accounting-system determination + checklist generation
- `artifacts/api-server/src/middlewares/auth.ts` — `requireAuth` / `requireRole` (RBAC)
- `artifacts/m15-audit/src/` — frontend pages/components

## Architecture decisions

- The user originally requested NestJS + Prisma/TypeORM; this workspace is pre-wired for Express + Drizzle + OpenAPI/Orval codegen instead. Substituted equivalent architecture rather than fighting the platform (communicated to the user up front).
- Multi-tenancy is a `firmId` column on every table (not schema-per-tenant) — the accepted alternative to the originally requested Postgres-schema-per-tenant approach.
- Document files (module M6/GED) are stored as base64 text directly in the `documents` table — no object storage integration for MVP scale.
- JWT signing reuses the existing `SESSION_SECRET` platform secret instead of provisioning a new one.

## Product

- **M9 (Admin/Auth/RBAC)**: firm registration, login, user invitation/management with 4 roles (expert_comptable, collaborateur, stagiaire, client_pme), full audit log.
- **M1 (Client/Dossier management)**: client registry with KYC fields, mission-status dashboard.
- **M4 + P2 (Visa engine)**: opening a mission auto-determines the SYSCOHADA accounting system (SMT/ALLEGE/NORMAL) from sector + turnover and generates a control checklist; status tracker (en_attente → en_cours → anomalie/valide → visa_emis).
- **M6 (GED)**: per-client document folders with category tagging, upload/download/delete.

## User preferences

_None recorded yet._

## Gotchas

- When adding an OpenAPI operation with both a path param and a query param on the same route, Orval's generated Zod-schema param type can collide with the generated TS param type of the same name (`<Op>Params`) — avoid mixing path+query params on one operation, or the codegen typecheck fails with TS2308.
- Don't use `format: email` in the OpenAPI spec — the pinned zod version's top-level `zod.email()` (v4-preview API) isn't available on the plain `zod` import Orval generates against; use a plain string field instead.
- Use `application/json` + base64 string fields for file uploads in the spec, not `multipart/form-data` with `format: binary` — the latter generates `File`/`Blob` types that don't resolve in this Node-only lib package.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
