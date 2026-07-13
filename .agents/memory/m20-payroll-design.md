---
name: M20 Ivorian payroll & social declarations design
description: Key design decisions for the Gestion de la Paie, ITS & CNPS module (M20)
---

# M20 Gestion de la Paie, ITS & CNPS

## Key files
- DB schema: `lib/db/src/schema/payroll.ts` — `employeesTable`, `payslipsTable`
- Engine: `artifacts/api-server/src/lib/payroll-engine.ts`
- Route: `artifacts/api-server/src/routes/payroll.ts`
- Frontend: `artifacts/m15-audit/src/pages/paie.tsx`, routed at `/cabinet/client/:clientId/paie`
- Nav tab added to `ClientAccountingNav.tsx` CABINET_TABS set

## Tax model choice
Engine implements the **classical pre-2024-reform** three-tax breakdown (IS + CN + ITS/IGR via quotient familial), not the unified post-Ordonnance-2023-718/719 ITS. This was explicit in the module spec. If a client needs the post-2024 unified barème (flat RICF reduction instead of quotient familial, no 20% abattement, single bracket table on full gross), swap the ITS/IGR section of `payroll-engine.ts` — CNPS and IS/CN math are unaffected either way.

## Ledger posting pattern
Same direct-DB-insert pattern as M17/M18/M19: `postPayrollLedger` bypasses `createTransactionEntry`, inserts `transactionsTable` + `journalLinesTable` directly with `status: "valide"` (payroll ledger entries are pre-validated, not sent to the M3 review queue). Debit 661 (salaires bruts) + 664 (charges patronales), credit 422 (net à payer) + 431 (CNPS) + 447 (IS/CN/ITS/FDFP taxes).

**Why:** payroll postings are a single monthly aggregate, not per-transaction PME entries — the payment-method/category validation in `createTransactionEntry` doesn't apply.

## Anti-double-post & recalculation
`payslipsTable.postedTransactionId` is the boundary: recalculating a period upserts (unique on employeeId+period) only *unposted* payslips; already-posted ones are skipped so a validated ledger entry never silently drifts from a later salary edit. Posting throws `PayrollAlreadyPostedError` if all payslips in the period are already posted, `NoPayslipsToPostError` if none were ever calculated.

## Period lock integration
Both `/payroll/calculate` and `/payroll/post-ledger` call `isPeriodLocked` (from `closing-engine.ts`, M19) keyed on the period's year — once a fiscal year is closed, payroll can no longer be calculated or posted for that year.
