---
name: Accrual (à crédit) settlement flow design
description: How credit/accrual operations are settled in the accounting module, and why the settlement is a separate reviewed transaction rather than an in-place edit.
---

Credit (à crédit) operations post to a third-party account (4111 Clients /
4011 Fournisseurs) at creation. When the PME later declares an invoice paid,
the settlement is **not** an edit to the original transaction's journal
lines — it's a brand-new transaction (`source: "settlement"`,
`parentTransactionId` pointing back to the original) that goes through the
exact same cabinet approval queue (`a_valider -> valide`) as any other entry.

**Why:** the app's core invariant is "every ledger-affecting entry is
cabinet-approved before it counts." Auto-posting the settlement leg without
review would special-case credit operations and break that invariant, plus
it keeps both legs of an accrual operation independently auditable.

**How to apply:** the original transaction's `settledAt` is stamped
immediately when the PME clicks "Marquer comme payé" (so it drops out of
"Factures en attente" right away), independent of whether the cabinet has
approved the settlement leg yet. A transaction can only be settled once
(`settledAt` set) and only after the cabinet has already validated the
original invoicing entry (`status === "valide"`). If extending this pattern
elsewhere, keep "settle now, review later" as the default rather than
inventing a new bypass path.
