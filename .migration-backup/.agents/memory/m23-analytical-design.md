---
name: M23 Analytical Accounting (Comptabilité Analytique)
description: Design decisions for module M23 — analytical axes, codes, per-line allocation (ventilation), and the analytical P&L report engine.
---

# M23 — Analytical Accounting

## DB Schema
- 3 new tables: `analytical_axes`, `analytical_codes`, `analytical_allocations` — all use `serial` PKs (integer), consistent with the rest of the schema.
- `analyticalAllocationsTable.percentage` is `doublePrecision`; `allocatedAmount` is `integer` (FCFA).
- Sum of percentages for a given `journalLineId` must be ≤ 100 (enforced at API layer, not DB).
- Drizzle `relations()` for `journalLinesTable` was added as a separate export `journalLinesAnalyticalRelations` — it only covers the M23-side `analyticalAllocations` many and the `transaction` one-side.

## Critical Backend Gotcha: journalLine→transaction relation type
- Even though `journalLinesAnalyticalRelations` includes `transaction: one(transactionsTable, ...)`, Drizzle's TS type for `findFirst({ with: { transaction: true } })` on `journalLinesTable` returns the base type without the relation (multiple `relations()` calls for the same table may not merge in the TS type layer).
- **Fix**: fetch the transaction separately by `transactionId` after loading the line. Do NOT use `with: { transaction: true }` on `journalLinesTable.findFirst`.
- For the report query: load all `analyticalAllocationsTable` rows with `{ with: { journalLine: true } }` (no nested transaction), then collect unique `transactionId` values and batch-fetch them with `inArray`.

## Frontend: Ventiler Dialog
- Shown in `comptabilite-cabinet.tsx` next to Class 6 (`accountNumber[0] === "6"`) and Class 7 (`accountNumber[0] === "7"`) journal lines.
- Uses `useSetJournalLineAllocations({ lineId, data: { allocations: [...] } })` — `lineId` is a path param, body is `{ allocations: [{ analyticalCodeId, percentage }] }`.
- Empty `allocations: []` clears all allocations for the line.
- Dialog initialises from existing `useListAnalyticalAllocations({ journalLineId })` on open, using a two-flag pattern (`initialised` / `!open`) to reset on close.

## OpenAPI schema: AnalyticalReportCodeRow
- `revenueByAccount` and `expenseByAccount` are optional in the generated TS types — always use `?? []` when accessing them in the frontend.

## Route: PUT /analytical/allocations/journal-line/{lineId}
- Body: `SetAllocationsInput` → `{ allocations: [{ analyticalCodeId, percentage }] }`
- Atomically deletes all existing allocations for the line and inserts the new set in a single transaction.
- clientId is resolved from the parent transaction, not passed in the body.

**Why:** Atomic replace (delete+insert) avoids partial-update conflicts when the accountant changes the split after the fact.
