# M15-AUDIT

Multi-tenant SaaS accounting platform for accounting firms in French-speaking Africa. Digitizes SYSCOHADA visa processes, accounting workflows, fiscal year closing, payroll (ITS/CNPS), fixed assets, and collaborative revision.

## Stack

- **Monorepo**: pnpm workspaces
- **Backend**: Node.js 24 + Express 5 (`artifacts/api-server`)
- **Frontend**: React 19 + Vite 7 + Tailwind CSS 4 + shadcn/ui + wouter (`artifacts/m15-audit`)
- **Database**: PostgreSQL via Drizzle ORM (`lib/db`)
- **API contract**: OpenAPI spec (`lib/api-spec/openapi.yaml`) → Orval codegen → React Query hooks + Zod schemas
- **Auth**: Custom JWT RBAC (bcryptjs, jsonwebtoken)

## How to run

Two workflows start automatically:
- **API Server** (`artifacts/api-server: API Server`): `pnpm --filter @workspace/api-server run dev`
- **Frontend** (`artifacts/m15-audit: web`): `pnpm --filter @workspace/m15-audit run dev`

## Environment

- `DATABASE_URL` — Replit-managed PostgreSQL (runtime-provided, do not set manually)
- `SESSION_SECRET` — Replit Secret (already configured)

## Database setup (first time or after re-import)

```bash
# Push schema
pnpm --filter @workspace/db run push

# Seed reference data
pnpm --filter @workspace/db run seed:roles
pnpm --filter @workspace/db run seed:accounts
pnpm --filter @workspace/db run seed:dsf-mapping-rules
pnpm --filter @workspace/db run seed:payroll-settings
pnpm --filter @workspace/db run seed:report-document-templates
```

## User preferences

- Keep existing project structure — do not restructure or migrate the monorepo layout.
