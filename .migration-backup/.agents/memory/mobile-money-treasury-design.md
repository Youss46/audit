---
name: Mobile Money treasury module design
description: Full-stack generalized Mobile Money treasury module for all PME clients — schema, accounting engine, API, frontend dialog, and dashboard page.
---

## What was built
A complete **Trésorerie Mobile Money** module covering:
1. DB tables: `mobileMoneyAccountsTable` (per-client, per-provider accounts with cached `balance`) and `mobileMoneyTransactionsTable` (audit trail with FK to `invoicesTable` for traceability).
2. Accounting engine functions in `artifacts/api-server/src/lib/accounting-engine.ts`: `computeMobileMoneyInflowJournalLines`, `computeMobileMoneyRepatriationOutflowLines`, `computeMobileMoneyRepatriationReceptionLines`.
3. API routes at `/api/mobile-money/*` in `artifacts/api-server/src/routes/mobile-money.ts`.
4. Extended `POST /api/invoices/:id/mark-paid` in `invoicing.ts` to handle `paymentMethod: "mobile_money"` with full double-entry settlement.
5. Frontend payment dialog inside `facturation.tsx` (replaces direct mutate call on "Marquer comme payée").
6. New page `artifacts/m15-audit/src/pages/tresorerie-mobile-money.tsx` with 4 tabs: Comptes, Ventes globales, Rapatriement, Historique.
7. Route `/tresorerie-mobile-money` in `App.tsx`, nav link + prefix guard in `Shell.tsx`.

## Key accounting design
- Providers map to Classe 55 sub-accounts: Wave→552200, Orange Money→552300, MTN MoMo→552400, Moov Money→552500; fee account 631700.
- Inflow (sale or invoice): Dr 552xxx (net) + Dr 631700 (fee) / Cr 701/706 or 411.
- Repatriation step 1 (outflow): Dr 585 / Cr 552xxx; step 2 (confirm): Dr 5211 / Cr 585.
- `585` "Virements de fonds — Mobile Money vers Banque" was added to chart of accounts.
- Invoice settlements use `source: "settlement"`, `parentTransactionId` back to the original validated invoice transaction.

## Balance tracking
- `balance` column on `mobileMoneyAccountsTable` is updated **at the time of the API call** (not at approval), mirroring the P5 Caisse Terrain pattern.
- Balance increments on inflows (net of fee), decrements on outflow/repatriation.

## Guardrails
- `AccountingEngineError` thrown if `feeAmount >= totalAmount` (would produce zero/negative net).
- Period lock checked on all write operations.
- Portal-role (client_pme / client_staff) endpoints scope to `req.user.clientId` automatically; cabinet users can pass `clientId` as a query/body param.
- `facturation.view` / `facturation.create` permissions reused for all new endpoints (no new RBAC).

**Why:** consistency with accrual-settlement pattern, P7 pump-shift precedent for direct DB inserts bypassing createTransactionEntry, and existing Classe 55 account structure.

**How to apply:** When extending this module, always bump account balance at DB insert time, and always generate a `mobileMoneyTransactions` row with `invoiceId` set when the source is an invoice payment.
