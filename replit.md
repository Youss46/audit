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
- `artifacts/api-server/src/middlewares/auth.ts` — `requireAuth` / `requireRole` (RBAC) / `requirePermission` (M29 permission-based gate for `client_staff` accounts)
- `artifacts/api-server/src/routes/staff.ts` — M29 staff CRUD (`GET /roles`, `GET/POST /staff`, `PATCH/DELETE /staff/:id`), owner-only
- `artifacts/m15-audit/src/pages/client-staff.tsx` — M29 "Équipe" screen (`/client/settings/staff`)
- `artifacts/m15-audit/src/` — frontend pages/components
- `lib/db/src/schema/fixed-assets.ts`, `financial-assets-loans.ts`, `closing.ts`, `payroll.ts` — M17/M18/M19/M20 domain tables
- `artifacts/api-server/src/lib/closing-engine.ts`, `payroll-engine.ts` — fiscal year closing (M19) and Ivorian payroll tax engine (M20)
- `artifacts/m15-audit/src/pages/immobilisations.tsx`, `finance.tsx`, `cloture-annuelle.tsx`, `paie.tsx` — cabinet-only modules routed under `/cabinet/client/:clientId/...`, tabs added via `ClientAccountingNav`'s `CABINET_TABS`

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
- **M17 (Immobilisations)**: Class 2 fixed-assets registry (SYSCOHADA account catalogue or custom entry), linear/degressive depreciation schedules, monthly dotation generation posted as `a_valider` entries for accountant review. Validated Class 2 debit lines from the general ledger auto-create pending-setup asset stubs.
- **M18 (Finance/Financements & Dettes)**: bank loans (Classe 16) and financial assets (Classe 27) with on-the-fly amortization schedules; due installments post pre-computed `a_valider` OD entries (debit loan/interest, credit Banque, or the reverse for financial assets).
- **M19 (Clôture Annuelle)**: one-way SYSCOHADA year-end closing — posts remaining dotations/échéances, clears Class 6/7 into the 131/139 net result, locks the fiscal year (blocks new/edited ledger entries for that year, `expert_comptable`-only), then generates the à-nouveaux opening balance for year+1 (Classes 1-5).
- **M20 (Gestion de la Paie, ITS & CNPS)**: per-client employee registry (salaire de base, prime de transport exonérée jusqu'à 30 000 FCFA, primes imposables, situation matrimoniale/enfants à charge, taux accident du travail) and monthly bulk payroll processing at `/cabinet/client/:clientId/paie`. `payroll-engine.ts` computes CNPS (part salariale 6.3%, patronale retraite 7.7% + prestations familiales 5.75% + accident du travail, capped at the retirement/social ceilings), IS (1.2% of 80% of taxable gross), CN (progressive brackets on the same base), and ITS/IGR (quotient familial parts × progressive brackets after a 15% abattement) — the classical pre-2024-reform three-tax breakdown, as specified for this module (see code comments for the post-2024 unified-ITS alternative). Recalculating a period upserts unposted payslips; posting aggregates the period into one balanced OD entry (debit 661 salaires + 664 charges patronales, credit 422 net à payer + 431 CNPS + 447 impôts), frozen against re-posting and blocked once the fiscal year is closed (M19).
- **M24 (Générateur de Liasse Fiscale / DSF SYSCOHADA Révisé)**: computes the full Bilan Actif/Passif, Compte de Résultat (cascade SIG), and Tableau des Flux de Trésorerie live from the validated general ledger, at `/cabinet/client/:clientId/dsf` and `GET /tax/dsf/:clientId/:year`. `dsf-engine.ts` derives every leaf line from a `dsf_mapping_rules` DB table (statementType + lineCode → comma-separated account-number patterns), each row falling back to the same hardcoded pattern if absent, so the table is safe to reseed or leave empty. Formulas/subtotals/SIG cascade/TFT structure stay in code — only leaf account-pattern lists are DB-driven. Exports a 3-sheet styled Excel via `GET /tax/exports/dsf?clientId=&year=` (no PDF yet).
- **M26 (Révision Collaborative & Chat Contextuel — "le Slack de la Révision Comptable")**: contextual, threaded discussions attached to any ledger entry, GED document, or tax declaration, at `/cabinet/client/:clientId/revision` (speech-bubble icon per row, opens a Slack-style slide-over) and a "Demandes du Cabinet en cours" widget on `/portal`. A `collaboration_threads` table (one row per `firmId + targetType + targetId`, holding `isResolved`/`resolvedById`/`resolvedAt`) sits above `contextual_comments` (the messages) so thread-list/badge queries don't need to scan every comment; a new comment on a resolved thread auto-reopens it. Only `expert_comptable`/`collaborateur` can resolve a thread. Attachments reuse the GED base64-in-Postgres pattern, served to the client as a `data:` URL. A persistent notification bell (topbar, all roles) is backed by `notifications` rows plus a best-effort `ws` WebSocket layer at `/api/ws` (auth via `?token=` query param, since browsers can't set headers on the WS handshake) — the bell also polls every 20s so it degrades gracefully if the socket never connects. Architecture substitutions from a generic "Slack-clone" brief: kept Express/Drizzle/Postgres (not NestJS), serial integer PKs (not UUID), and the base64 `data:` URL (not a literal `attachment_url` string) — consistent with every other module's stack.
- **M29 (RBAC & Gestion du Personnel PME)**: `client_pme` dossier owners can create restricted staff accounts (`client_staff` role) at `/client/settings/staff` — Administrateur, Commercial, Agent Terrain/Pompiste, Comptable Interne — each mapped to a fixed permission set from a global `roles` catalog (no per-firm custom permissions in this MVP). Staff share the owner's exact dossier scoping (`isPortalRole()` helper, mirrored in both backend `@workspace/db` and a frontend copy in `lib/status.ts` since the frontend can't import the DB package) but every list/create/report/invoice route additionally requires a specific permission key (`dashboard.view`, `operations.*`, `caisse.*`, `pilotage.view`, `facturation.*`) via `requirePermission()` middleware, which only restricts `client_staff` — every other role bypasses unchanged. Staff management itself is gated by the literal `client_pme` role, not a permission flag, so no staff account (even an "Administrateur") can ever create or edit other staff. Permissions are resolved once at login and embedded in the JWT, matching the existing session model where role changes require a fresh login. Architecture substitution: no separate `Staff_Users` table as originally specified — extended the existing unified `users` table with `role="client_staff"` + nullable `roleId` FK instead, to stay consistent with the rest of the schema.
- **M30 (Aide & Support)**: a "?" icon in the topbar (all roles) opens a slide-over with a static FAQ accordion and a support contact card. Purely hardcoded content — no backend, no new table.
- **M31 (Messagerie Interne du Cabinet — "le Slack du Cabinet")**: internal chat for cabinet staff only (`expert_comptable`/`collaborateur`/`stagiaire` — `isPortalRole()` accounts get a 403 server-side and never see the nav link), at `/cabinet/communication`. Public channels (anyone in the firm can view/post, auto-joins on first post) and private channels (invite-only at creation), plus 1:1 direct messages between any two colleagues in the same firm, with online/offline presence. Attachments reuse the base64-in-Postgres pattern (M6/M26) via a stateless `POST /chat/upload` validate-and-echo endpoint — the frontend attaches-then-sends rather than a real upload step. Architecture substitutions from a generic "Slack-clone with NestJS/UUID/dedicated-gateway" brief: kept Express/Drizzle/serial-int-PKs, multiplexed `chat:*` events onto the existing single `/api/ws` hub (no second WebSocket gateway) with new firm-scoped presence tracking (`firmIdBySocket`/`onlineUserIdsByFirm` in `realtime.ts`), and no separate `Staff_Users` table — "staff" is just `!isPortalRole(role)` on the existing unified `users` table.
- **P7 (Un Pompiste = Un Shift — Relevé d'Index & Ventes de Carburant)**: gives the "Relevé d'index de pompe" and "Ventes de carburant" Espace PME cards, previously both routed to the generic Caisse Express, their own dedicated screens at `/releve-index` and `/ventes-carburant(/:id)`. A `pump_shifts` row is one pump/fuel shift's full lifecycle: "Relevé d'index" creates it (`indexStart` always resolved server-side from that pump+fuel's own last shift, never trusted from the client, so sold volume can't be inflated) and "Ventes de carburant" finalizes it ("Valider le Shift" sets unit price + payment method, posts the sale through the shared `createTransactionEntry()` helper under a new `vente_carburant` category (701), and — for `especes` settlements only — compares declared physical cash to the theoretical amount, booking any écart as a separate reviewable transaction against the pompiste's own P6 cash-drawer sub-account). Other payment methods (mobile money, etc.) skip the physical-cash comparison entirely.

## User preferences

_None recorded yet._

## Gotchas

- When adding an OpenAPI operation with both a path param and a query param on the same route, Orval's generated Zod-schema param type can collide with the generated TS param type of the same name (`<Op>Params`) — avoid mixing path+query params on one operation, or the codegen typecheck fails with TS2308.
- Don't use `format: email` in the OpenAPI spec — the pinned zod version's top-level `zod.email()` (v4-preview API) isn't available on the plain `zod` import Orval generates against; use a plain string field instead.
- Use `application/json` + base64 string fields for file uploads in the spec, not `multipart/form-data` with `format: binary` — the latter generates `File`/`Blob` types that don't resolve in this Node-only lib package.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
