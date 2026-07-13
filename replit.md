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

- **M9 (Admin/Auth/RBAC)**: firm registration, login, user invitation/management with 4 roles and a hardened permission matrix — expert_comptable (full access, sole role that can delete a client dossier or issue the final Visa stamp), collaborateur (manages clients/missions/documents/checklist validation, cannot delete clients or issue the Visa), stagiaire (read-only: can view checklists/documents and add checklist observations/notes, cannot validate checklist items, upload/delete documents, or create/edit/delete clients and missions), client_pme (own portal only, unchanged from P2). Frontend hides/disables the corresponding buttons per role to match. Every mutating route and login writes an audit log entry (`id, firmId, userId, userName, userRole, action, entityType, entityId, details, ipAddress, createdAt`) using standardized English action-type constants (`AuditAction` in `artifacts/api-server/src/lib/audit.ts`, e.g. `VISA_ISSUED`, `CHECKLIST_VALIDATE`, `DOCUMENT_UPLOAD`); `app.set("trust proxy", true)` is set so `req.ip` resolves correctly behind Replit's proxy. Journal d'Audit page displays role and IP columns.
- **M1 (Client/Dossier management)**: client registry with KYC fields, mission-status dashboard.
- **M4 + P2 (Visa engine)**: sector/turnover determines the SYSCOHADA system (SMT < 60M commerce / 40M artisanat / 30M services; ALLEGE up to 100M; NORMAL above) the moment it's entered on the client profile, and generates a control checklist (12/24/36 regulatory items + 2 standard checks: balance sheet concordance, fiches R1-R4) when a mission opens. Mission status is a strict state machine (en_attente → en_cours → valide → visa_emis); "anomalie" is system-driven, entered/exited automatically as checklist items are flagged/resolved (never chosen manually). Flagging a checklist item as anomalie requires a comment. Reaching visa_emis mocks a digital visa stamp (`visaStampCode` + `visaIssuedAt` on the mission) and locks the checklist.
- **M6 (GED)**: per-client document folders (Permanents / Exercice {year}, auto-populated "Procédure de Visa" folder for portal uploads) with category tagging, upload/download/delete, and a shortcut from each exercise folder to its M4 checklist.
- **P2 (Espace PME client portal)**: `client_pme` accounts are bound to exactly one client dossier (`users.clientId`) and land on a dedicated `/portal` page — a drag-and-drop zone (PDF/PNG/JPEG) to submit tax/financial documents. Uploading auto-tags the file "Procédure de Visa", attaches it to the client's active mission, and flips that mission from `en_attente` to `en_cours`. `client_pme` accounts are scoped server-side to their own client's `clients`/`missions`/`documents` records (403 otherwise) and cannot mutate mission/checklist state or delete documents.

## User preferences

_None recorded yet._

## Gotchas

- When adding an OpenAPI operation with both a path param and a query param on the same route, Orval's generated Zod-schema param type can collide with the generated TS param type of the same name (`<Op>Params`) — avoid mixing path+query params on one operation, or the codegen typecheck fails with TS2308.
- Don't use `format: email` in the OpenAPI spec — the pinned zod version's top-level `zod.email()` (v4-preview API) isn't available on the plain `zod` import Orval generates against; use a plain string field instead.
- Use `application/json` + base64 string fields for file uploads in the spec, not `multipart/form-data` with `format: binary` — the latter generates `File`/`Blob` types that don't resolve in this Node-only lib package.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
