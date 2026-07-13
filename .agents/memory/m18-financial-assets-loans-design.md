---
name: M18 financial assets & loans design
description: Key design decisions for the financial fixed assets & loans module (M18)
---

# M18 Financial Assets & Loans (Financements & Dettes)

## Rule
Schedule computed on-the-fly from 5 params; `installmentsPosted` counter is the
anti-double-post boundary — getDueUnpostedInstallments filters on installmentNumber > installmentsPosted.

**Why:** Storing schedule rows would require re-generation whenever the user edits parameters.
On-the-fly computation is deterministic and avoids stale cached schedules.

## Generate-entries pattern
Direct DB insert into transactionsTable + journalLinesTable (same as M17/M19 closings),
never through createTransactionEntry. Status = "a_valider" so accountant reviews in M3 queue.

**Why:** createTransactionEntry enforces payment-category rules that don't apply to
pre-computed bank installment movements.

## ClientAccountingNav integration
Finance tab routes to /cabinet/client/:id/finance (CABINET_TABS set).
Four useRoute() calls needed: comptabilite, cloture, immobilisations, finance — first non-null wins.

## SYSCOHADA account picker
Two catalogues: LOAN_ACCOUNTS (Classe 16: 161100–168000) and
FINANCIAL_ASSET_ACCOUNTS (Classe 27: 271000–276000). Switching type resets form
(emptyForm(type)) and accountPickerMode → catalogue.

## Schedule drawer summary
scheduleSummary derived via useMemo from schedule.rows:
postedCount/pendingCount, progressPct, totalAnnuity, totalInterest, pendingAnnuity.
Progress bar also shown inline in registry table (installmentsPosted / totalInstallments).

## Journal accounts
EMPRUNT_BANCAIRE: Debit loan account (161x) + 671 (interest), Credit 52 (Banque).
IMMOBILISATION_FINANCIERE: Debit 52 (Banque), Credit 27x account (principal) + 771 (interest).
Interest line omitted when interestAmount === 0 (zero-rate deposits/advances).

**How to apply:** Any new cabinet-only tab must be added to CABINET_TABS in ClientAccountingNav.
The four-useRoute pattern is the standard detection approach for all cabinet tabs.
