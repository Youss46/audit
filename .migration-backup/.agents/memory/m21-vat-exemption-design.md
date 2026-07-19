---
name: M21 VAT-exemption (non-assujetti) handling
description: Where the "client not subject to VAT" (EXONERE / isVatRegistered=false) logic lives across the stack, so a future request to "add VAT exemption support" doesn't get re-implemented from scratch.
---

# VAT-exemption (non-assujetti à la TVA) design

This is already implemented end-to-end, not a gap:

- **Schema**: `clients.taxRegime` enum (`REEL_NORMAL`, `REEL_SIMPLIFIE`, `ENTREPRENANT`, `EXONERE`) and `clients.isVatRegistered` boolean (default true) — `lib/db/src/schema/clients.ts`.
- **Shared guard**: `isVatAccount(accountNumber)` (true for any `443*`/`445*` account) and `ClientNotVatRegisteredError` (400, French message) live in `artifacts/api-server/src/lib/vat-engine.ts`. Reuse these rather than re-deriving the account-prefix check.
- **Enforced at**: journal-line creation (`createTransactionEntry`, shared by `POST /transactions` and the batch sync route), the manual account-redirect route (`PATCH /transactions/:id/journal-lines`), and the VAT liquidation route (`POST /tax/vat-liquidation/:clientId/:period` in `routes/tax.ts`) which also blocks the whole D-201/VA declaration/export for non-registered clients.
- **Frontend**: `client-new.tsx` / `client-detail.tsx` expose the régime dropdown + "Assujetti à la TVA" switch (French labels); `comptabilite-cabinet.tsx` disables editing a journal line onto a VAT account when the client isn't registered; `teledeclaration.tsx` shows a banner and hides D-201/VA generation for non-registered clients.

**Why:** the plain-language P3 category engine (`accounting-engine.ts computeJournalLines`) never emits VAT lines itself (it's a 2-line HT-only engine), so the "block VAT lines" guard is currently defense-in-depth rather than something that fires in the default flow — don't assume it's a no-op gap.

**How to apply:** before building a "handle non-VAT-registered clients" feature, grep for `isVatRegistered` / `isVatAccount` first — most of the standard requirements (schema flag, dropdown/toggle UI, blocking 443/445 postings, disabling TVA e-filing) are usually already there.
