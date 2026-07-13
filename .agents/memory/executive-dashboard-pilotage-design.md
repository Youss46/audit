---
name: Executive BI dashboard (Tableau de Bord Dirigeant) design decisions
description: Formulas and modeling choices behind the pilotage/executive-dashboard aggregates (margin, break-even, cash basis, expense-nature buckets) — read before extending or re-deriving these numbers.
---

Built by extending the pre-existing "Pilotage Dirigeant" module in place (same
component reused at `/pilotage` for client_pme self-service and
`/cabinet/client/:clientId/pilotage` for cabinet monitoring) rather than
creating a parallel dashboard. When a BI/reporting request looks new, check
first whether a smaller version already exists under a different module name
before building a duplicate — this codebase's numbered modules ("P4", "M8",
etc.) sometimes already cover part of a newly-requested feature.

**Formulas/decisions, in case they need to be re-derived or adjusted:**
- Marge brute = CA (class 7) − charges variables (class 60, includes all
  60x sub-accounts e.g. 605 fournitures non stockables — this is correct
  SYSCOHADA nomenclature, not a bug).
- Seuil de rentabilité: charges fixes = classes 61–65 only (66 Personnel is
  deliberately excluded, per the literal spec given for this feature — not an
  oversight). `seuil = chargesFixesAnnuelles / tauxMargeSurCoutsVariables`,
  null when the rate is ≤ 0 (break-even undefined).
- Cash-basis ("comptabilité de trésorerie") toggle: a cash transaction counts
  on its transaction date in both bases; a credit transaction counts only
  once settled, attributed to the settlement date; unsettled credit
  transactions are excluded entirely under cash basis. Verified via a
  credit-sale settled in a later month: it correctly moved from being
  excluded to appearing in the settlement month's CA, cash basis only.
- Expense-by-nature buckets: 60→Achats, 61+62+63→Services extérieurs,
  66→Personnel, 64→Impôts et taxes, rest of class 6→Autres charges.
- "Mois courant" for MoM KPI deltas = the most recent month with actual
  booked activity in the selected year, not the calendar's current month —
  so KPI cards always compare two populated months instead of comparing
  against an empty future month.

**Why:** these are judgment calls made where the request didn't fully spec
the formula; documented so future changes stay consistent instead of
silently drifting to a different definition.
