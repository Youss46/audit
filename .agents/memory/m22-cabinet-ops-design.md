---
name: M22 Cabinet Internal Operations & Profitability
description: Design decisions for module M22 — timesheets, collaborator cost/billing rates, client forfait contracts, and the per-client profitability engine.
---

# M22 Cabinet Internal Operations & Profitability

## Schema
- All 3 tables already existed in `lib/db/src/schema/cabinet-ops.ts` and Drizzle relations in `relations.ts` before this module was built.
- DB primary keys are `serial` (integer), not UUID — consistent with all other tables in this project.

## Backend Route
- Lives in `artifacts/api-server/src/routes/cabinet-analytics.ts`, mounted last in `routes/index.ts`.
- Rate upsert uses PUT — a collaborator can only have one rate row (UNIQUE on userId), so always upsert.
- Profitability: if a client has multiple overlapping contracts (renegotiated), the one with the latest `startDate` wins.
- Non-expert callers are silently scoped to their own timesheet entries (userId override ignored).
- Returns early with empty data (not 404) when no entries exist for the period.

## Frontend API call patterns
- `useListTimesheetEntries(params?, options?)` — dateFrom/dateTo go as the first argument, not inside `request.params`.
- `TimesheetEntryInput.date`, `TimesheetEntryUpdate.date`, `ClientContractInput.startDate` are plain strings in generated types — pass `.toISOString()` directly.

## Pre-existing issue fixed
- `export-engine.ts` had 3 Buffer cast errors; fixed to `as unknown as Promise<Buffer>`.

**Why:** Orval generates date fields as strings in TypeScript interfaces even when Zod uses `zod.coerce.date()`. The server coerces on parse; the client sends strings.
