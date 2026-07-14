---
name: Mobile Money pump-shift split-payment design
description: Design decisions for Module P7 Mobile Money integration — split-payment fuel sales and MM→Bank virement.
---

# Mobile Money / Pump-Shift Split-Payment Design

## Schema change
`pump_shifts` table gained 4 nullable integer columns:
`cash_amount`, `wave_amount`, `orange_money_amount`, `mtn_momo_amount`.
Their sum MUST equal `expected_amount` at validation time (enforced in validate route).
The legacy `payment_method` column is kept (nullable) for backward compat with old records;
new records store derived value: `especes` | `mobile_money` | `null` (mixed).

## Account mapping (Classe 55)
- 552100 → Orange Money
- 552200 → Wave
- 552300 → MTN MoMo
- 552400 → Moov Money
- 631700 → Frais sur instruments monétaires électroniques
All added to seed-accounts.ts.

## Accounting engine additions (accounting-engine.ts)
- `MOBILE_MONEY_PROVIDER_ACCOUNTS` / `MOBILE_MONEY_PROVIDER_LABELS` — exported maps
- `computeFuelSaleJournalLines()` — multi-debit entry (one leg per active channel, credit 701)
- `computeMobileMoneyVirementJournalLines()` — compound entry: Dr 52 (net) + Dr 631700 (fee) / Cr 552xxx
- `frais_mobile_money` category rule → 631700 (hidden, system-generated)

## Route changes
- `POST /pump-shifts/:id/validate` — **bypasses `createTransactionEntry`** (direct DB insert),
  uses `computeFuelSaleJournalLines` for multi-leg entry.
  Discrepancy (écart) computed against `cashAmount` only, not total `expectedAmount`.
- `POST /mobile-money/transfers` (new, `routes/mobile-money.ts`) — cabinet-only;
  returns a draft "depense / frais_mobile_money" transaction with 3 journal lines.

**Why bypass createTransactionEntry for the fuel sale:**
`createTransactionEntry` only produces 2-line entries via `computeJournalLines`.
Multi-provider split payments require N+1 journal lines — must insert directly.
Period lock check is still performed manually in the route.

## OpenAPI / codegen
`PumpShiftValidateInput` now has `cashAmount`, `waveAmount`, `orangeMoneyAmount`, `mtnMomoAmount`
(all int, min 0, default 0) + `declaredPhysicalAmount` (nullable).
`paymentMethod` field removed from input (derived server-side).
`PumpShift` response gains the 4 new nullable amount fields.
New schemas: `MobileMoneyProvider`, `MobileMoneyVirementInput`, `MobileMoneyVirementResult`.

## Frontend (fuel-sales.tsx)
Replaced single paymentMethod Select with 4 AmountInput fields (French labels):
"Espèces", "Paiement Wave", "Paiement Orange Money", "Paiement MTN MoMo".
Running total vs expected shown in real-time; "Frais de retrait" field shown only when cashAmount > 0.
