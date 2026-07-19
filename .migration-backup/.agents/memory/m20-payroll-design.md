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
As of Feb 2026, the engine implements the **unified post-2024-reform ITS** (Ordonnance n°2023-718/719): taxable base = grossTaxable × 0.85, one direct progressive bracket scale (quick-deduction/"correctif" method, not marginal accumulation) on that base, then a flat RICF % reduction keyed on family parts (table: 1 part→0%, 1.5→10%, 2→15%, 2.5→20%, 3→25%, 3.5→30%, 4→35%, 4.5→40%, ≥5→45%) — no quotient-familial division of the base. `isAmount`/`cnAmount` are hardcoded to 0 (fields kept in schema/API for historical-bulletin compatibility); the full withholding lives in `itsAmount`. CNPS also uses a single unified ceiling (3,375,000 FCFA/month) applied to `grossSalary` (not `grossTaxable`) for both employee and employer shares — replacing the old two-tier ceiling (750k social / 3.75M retirement) on `grossTaxable`. The engine previously implemented the classical pre-reform IS+CN+ITS/quotient-familial breakdown; if a future request needs to revert to that model, see git history on `payroll-engine.ts`.

## Ledger posting pattern
Same direct-DB-insert pattern as M17/M18/M19: `postPayrollLedger` bypasses `createTransactionEntry`, inserts `transactionsTable` + `journalLinesTable` directly with `status: "valide"` (payroll ledger entries are pre-validated, not sent to the M3 review queue). Debit 661 (salaires bruts) + 664 (charges patronales), credit 422 (net à payer) + 431 (CNPS) + 447 (IS/CN/ITS/FDFP taxes).

**Why:** payroll postings are a single monthly aggregate, not per-transaction PME entries — the payment-method/category validation in `createTransactionEntry` doesn't apply.

## Anti-double-post & recalculation
`payslipsTable.postedTransactionId` is the boundary: recalculating a period upserts (unique on employeeId+period) only *unposted* payslips; already-posted ones are skipped so a validated ledger entry never silently drifts from a later salary edit. Posting throws `PayrollAlreadyPostedError` if all payslips in the period are already posted, `NoPayslipsToPostError` if none were ever calculated.

## Period lock integration
Both `/payroll/calculate` and `/payroll/post-ledger` call `isPeriodLocked` (from `closing-engine.ts`, M19) keyed on the period's year — once a fiscal year is closed, payroll can no longer be calculated or posted for that year.
