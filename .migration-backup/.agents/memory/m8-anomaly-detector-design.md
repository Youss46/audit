---
name: M8 anomaly detector rule design
description: How the rule-based duplicate/incoherence/amount-spike detector is wired into the transaction pipeline, and why warnings never block approval.
---

Module M8 (Anomalie & Doublon Detector) runs three deterministic rules —
duplicate (same client/amount within a 24h window), accounting incoherence
(counterpart journal-line account class mismatched with recette/dépense),
and amount spike (>3x the trailing 3-month client+category average) —
storing the result as a `string[]` code array on the transaction row.

**Why:** The accountant must always be able to see *exactly* why an entry
was flagged (no black-box scoring), and the flag must never be a hard
gate — legally justified entries still need to clear the ledger without a
backend override switch.

**How to apply:** Anomalies are computed once at entry creation and
recomputed whenever journal lines are adjusted (an account-number redirect
can turn a coherent entry incoherent or vice versa). Approval is never
blocked by a non-empty anomalies array — the existing approve endpoint is
reused unchanged, and only the audit-log action/detail string changes
(`TRANSACTION_FORCE_VALIDATE` instead of `TRANSACTION_APPROVE`) to record
that the override happened. The frontend swaps the same button's label to
"Forcer la validation" rather than adding a second endpoint or a separate
confirmation flow.
