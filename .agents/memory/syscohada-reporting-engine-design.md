---
name: SYSCOHADA automated financial statements design
description: How Balance/Bilan/Compte de Résultat/Pilotage are derived from the validated ledger without a fiscal-year or opening-balance schema.
---

The schema has no `fiscalYear` field on clients and no opening-balance-per-year table. Reporting treats "fiscal year" as a plain calendar-year filter on `transactions.date`, and computes each account's opening balance as the running net (debit − credit) of all `status='valide'` journal lines dated strictly before the year start.

Bilan Simplifié is aggregated at the account-**class** level (not per-account): classes 2/3 → Actif; class 4 → Actif if net debit else Passif; class 5 → Actif if non-negative else Passif; class 1 → Passif. The year's résultat net (classes 6/7) is folded into Passif under "Capitaux propres" — this is standard SYSCOHADA practice and also makes Actif = Passif fall out automatically, since debit=credit across the whole ledger by construction (double-entry). No manual reconciliation/forcing needed.

Pilotage (P4) "Trésorerie Nette" is deliberately point-in-time (as of now), not year-scoped, since a director always wants today's real cash number — independent of whichever fiscal year is selected for the monthly revenue/expense charts on the same page.

**Why:** avoids introducing new schema/migrations for a reporting-only MVP feature while staying mathematically correct (verified totalActif === totalPassif against real seeded data).

**How to apply:** when extending or debugging `reporting-engine.ts` (in `artifacts/api-server/src/lib/`), preserve this class-level Bilan aggregation and the "no opening-balance-table" trick rather than reintroducing a fiscal-year schema field.
