---
name: Pump initial calibration design
description: pumpsTable, last-index fallback chain, and pump settings UI for Module P7.
---

## Rule
`GET /pump-shifts/last-index` uses a two-priority fallback:
1. Most recent **VALIDATED** shift's `indexEnd` (changed from any shift — only validated shifts count).
2. `pumpsTable.initialIndex` for the matching `clientId + label + fuelType`.
3. `null` if neither exists.

**Why:** Without the initial calibration, the first-ever shift would start at 0, producing a nonsensical huge volume. The pump registration screen lets the PME owner enter the real meter reading at onboarding time.

## Key design decisions
- `pumpsTable` is a separate table (`lib/db/src/schema/station-service.ts`), not a column on `pumpShiftsTable`. Each physical pump (label + fuelType combo) has one row per client.
- `pumps.ts` route uses only `@workspace/api-zod` for parsing — **never import bare `zod` in api-server routes**; esbuild can't resolve it (it's not a direct dependency of that package).
- CRUD is gated to `client_pme` role only (same pattern as the staff management page).
- Route: `/client/settings/pumps` → `PumpSettings` page.
- Shell redirect guard covers both `/client/settings/staff` and `/client/settings/pumps`.
- The `pump-index.tsx` Pompiste form needs no change — `indexStart` still comes from `lastIndex?.indexEnd ?? 0`; now the server returns `initialIndex` when no shift exists instead of `null`.
