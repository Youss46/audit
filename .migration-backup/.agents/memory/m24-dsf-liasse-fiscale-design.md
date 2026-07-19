---
name: M24 DSF / Liasse Fiscale design
description: How the automated SYSCOHADA tax-return (DSF) generator was wired up and DB-driven — read before touching dsf-engine.ts or dsf_mapping_rules.
---

## Context
A complete, pure-function SYSCOHADA DSF engine (`computeDsf` in `artifacts/api-server/src/lib/dsf-engine.ts`) already existed in the imported codebase but was never wired up — no route, no frontend page, no DB table. Before assuming a described feature is "missing", check whether the compute engine already exists unwired; grep for the function name across routes first.

## Design decision: DB-driven mapping rules with safe fallback
Every hardcoded account-number-pattern array inside the four `compute*` functions (Bilan Actif, Bilan Passif, Compte de Résultat, TFT) was replaced with a `pat(rules, lineCode, fallback)` lookup against a new global (non-firm-scoped) `dsf_mapping_rules` table. `pat()` returns the DB row's patterns if present, otherwise the exact original hardcoded array.

**Why:** this makes the DB table purely additive — behavior is byte-identical whether the table is empty or fully seeded, so wiring it in carries no regression risk versus the pre-existing hardcoded engine. Formulas, subtotals, the SIG cascade, and TFT structure stayed in code; only leaf account-pattern lists moved to the DB, since those are genuine input data, not derived calculations.

**How to apply:** if the DSF/liasse fiscale mapping ever needs to change for a specific line (e.g. a new SYSCOHADA account added to a bucket), edit/insert a row in `dsf_mapping_rules` (statementType + lineCode, comma-separated `accountPatterns`) rather than touching `dsf-engine.ts`. Reseed via `pnpm --filter @workspace/db run seed:dsf-mapping-rules` (idempotent, `onConflictDoUpdate`).

## Verified via live API calls (no UI login flow available for screenshot)
Registered a throwaway firm/user/client, posted real transactions (vente, prestation, loyer, salaires, achat) through the normal `/transactions` + `/transactions/:id/approve` flow, then called `GET /tax/dsf/:clientId/:year`: résultat net flowed correctly through the SIG cascade (TA→XA→XB→XC→XD→XF→XI), cash landed in Trésorerie-Actif (BI/BJ), and `balanceEquilibre`/`bilanEquilibre` were both true. `GET /tax/exports/dsf` returned a valid 3-sheet .xlsx. Test data was deleted afterward.
