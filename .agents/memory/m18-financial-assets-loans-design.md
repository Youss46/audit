---
name: M18 Financial Assets & Loans (Financements & Dettes) design
description: Design decisions for the financial fixed-assets/loans amortization module (Immobilisations Financières & Emprunts) — read before touching amortization, loan, or financing-related features.
---

## Core model
A single table holds both directions of a financing relationship: `EMPRUNT_BANCAIRE` (we owe a bank) and `IMMOBILISATION_FINANCIERE` (someone owes us — deposits, financial loans granted). Same shape, same engine, opposite journal-entry direction.

## No stored schedule rows
The amortization schedule is never persisted. It's recomputed on every read from 5 core params (principal, annual rate, start date, term in months, payment frequency), using constant-annuity (French/bank) amortization — degenerating to equal-principal split when rate = 0. This mirrors the M17 fixed-assets/depreciation pattern in this codebase: compute-on-read beats storing derived rows.

**Why:** keeps the table tiny and avoids any schedule/DB drift; the only thing that can go stale is the single `installmentsPosted` counter.

## `installmentsPosted` is the anti-double-post boundary
The only persisted mutable state is an integer counter of how many installments have been booked to the ledger. "Due and unposted" = installments whose due date has passed AND whose installment number > `installmentsPosted`. Posting a batch increments the counter by however many were generated. Calling generate-entries again with nothing newly due returns an explicit "skipped" result — never fails silently and never double-books.

## Generate-entries endpoint is per-client, not per-item
`POST /finance/generate-journal-entries/:clientId` iterates every ACTIF item (both types) for that client, computing due-and-unposted installments per item and posting one transaction per due installment. Same batching shape as M17's `generate-closings`, just keyed by due-date-crossed instead of fiscal-year-crossed.

## Journal account derivation (SYSCOHADA)
- `EMPRUNT_BANCAIRE` (we owe): Debit item's own account (161x, capital portion) + 671 (interest expense) / Credit 52 (Banque, treasury default).
- `IMMOBILISATION_FINANCIERE` (owed to us): Debit 52 / Credit item's own account (27x, capital) + 771 (interest income).
- Entries are inserted directly into the transactions/journal-lines tables, bypassing the category-driven `accounting-engine.ts` — same bypass M17 uses for pre-computed treasury postings that aren't PME-category driven.

## Verified behavior (2026-07-13)
End-to-end tested via direct API calls: created a 1,200,000 FCFA / 6%/an / 12-month monthly loan starting in the past, called generate-journal-entries, got 6 due installments posted as 6 separate balanced transactions (capital+interest debit = treasury credit), counter incremented correctly, and a repeat call correctly skipped with "Aucune échéance due à ce jour" instead of re-posting.
