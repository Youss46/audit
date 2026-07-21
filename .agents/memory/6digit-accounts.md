---
name: 6-digit sub-account enforcement
description: All journal line accountNumber values must be exactly 6 digits. No posting to 3-digit or 4-digit parent accounts.
---

# 6-digit sub-account enforcement (completed)

## The rule
Every `accountNumber` written to `journalLinesTable` must be 6 digits. No parent accounts (3c or 4c) may be posted to directly.

**Why:** User requirement for strict SYSCOHADA compliance. Enables unambiguous sub-ledger analysis and regulatory reporting.

**How to apply:** Any new journal-writing code must use 6-digit codes. Use `pad6()` from `imputation-engine.ts` as a defensive guard when reading account numbers from DB or external input.

## pad6() convention
Located in `artifacts/api-server/src/lib/imputation-engine.ts`:
- 3c → append "100"  (e.g. "571" → "571100")
- 4c → append "00"   (e.g. "5211" → "521100", "6052" → "605200")
- 5c → append "0"
- ≥ 6c → identity
- Special: "471" → "471000", "472" → "472000" (attente accounts)

## Mobile Money provider mapping (Wave/Orange swap — per explicit user spec)
- `wave:         "552100"` ← Wave
- `orange_money: "552200"` ← Orange Money
- `mtn_momo:     "552300"`
- `moov_money:   "552400"`

Previous (incorrect) mapping had wave=552200 and orange_money=552100 — **do not revert**.

## Payment method → treasury account mapping
- `especes`:      `"571100"` Caisse principale
- `mobile_money`: `"552100"` generic (overridden by provider lookup)
- `cheque`:       `"513100"` Chèques à encaisser
- `virement`:     `"521100"` Banques locales

## Key third-party accounts
- `"411100"` Clients (was "4111" / "411")
- `"401100"` Fournisseurs d'exploitation (was "4011")
- `"445100"` TVA récupérable sur achats (was "4451")
- `"521100"` Banques locales (was "5211")
- `"585100"` Virements de fonds transit (was "585")
- `"471000"` Attente débiteurs (was "471")
- `"472000"` Attente créditeurs (was "472")

## Capital engine accounts
- `"521100"` Banques locales — capital versé (was "5211")
- `"461300"` Associés capital non versé (was "4613")
- `"101300"` Capital souscrit, appelé, versé (was "1013")

## Payroll engine accounts
- `"661100"` Salaires bruts (was "6611")
- `"664100"` Charges sociales patronales (was "664")
- `"422100"` Personnel rémunérations dues (was "422")
- `"431100"` CNPS (was "4311")
- `"447100"` ITS/Taxe apprentissage/FDFP (was "4471")

## Closing engine accounts
- `"130100"` Résultat bénéfice (was "1301")
- `"130900"` Résultat perte (was "1309")

## Seed
`lib/db/src/seed-syscohada.ts` — 270 accounts, 32 categories, all 6-digit where posted.
After any change, run: `pnpm --filter @workspace/db seed:syscohada`

## Files updated
- `lib/db/src/seed-syscohada.ts`
- `artifacts/api-server/src/lib/accounting-engine.ts`
- `artifacts/api-server/src/lib/imputation-engine.ts`
- `artifacts/api-server/src/lib/payroll-engine.ts`
- `artifacts/api-server/src/lib/capital-engine.ts`
- `artifacts/api-server/src/lib/closing-engine.ts`
- `artifacts/api-server/src/routes/invoicing.ts`
- `artifacts/api-server/src/routes/purchases.ts`
- `artifacts/api-server/src/routes/mobile-money.ts`
- `artifacts/api-server/src/routes/clients.ts`
