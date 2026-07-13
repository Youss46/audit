---
name: Caisse Terrain (module P5) design decisions
description: Why cash-register balance updates at entry time, why closure resets it, and how the écart booking / shared single-vs-batch validation pattern works.
---

## Register balance timing
`cashRegistersTable.currentBalance` updates immediately when a cash transaction is created (single or batch), not when the cabinet approves it via the "à valider" review pipeline.

**Why:** P5 tracks physical cash reality on the ground; the cabinet's GL approval workflow is a separate, slower process. A field agent's phone must reflect what's actually in the drawer right now, independent of accounting review latency.

**How to apply:** Any new code path that creates a cash (`paymentType: "cash"`, `paymentMethod: "especes"`) transaction with a `cashRegisterId` must call the same balance-increment/decrement helper used by transaction creation and settlement — don't gate it on approval status.

## Daily closure & écart booking
One `daily_closures` row per register per calendar day, auto-created on first fetch. Theoretical balance = live register balance at close time; physical count is manually entered. On close, `currentBalance` is reset directly to the physical count (not the theoretical one) — the physical count becomes the new source of truth going forward. If discrepancy ≠ 0, a comment is mandatory and a separate ledger transaction (source `caisse_closure`, hidden categories `ecart_caisse_gain`/`ecart_caisse_perte`, accounts 758/658) is created and pushed into the cabinet's normal "à valider" queue — never an edit of any existing entry. This écart transaction does NOT touch the register balance itself (the reset above already did that).

**Why:** Keeps the audit trail honest (every FCFA discrepancy is a reviewable, justified transaction) while still letting the physical count immediately become ground truth for the next day's opening balance.

**How to apply:** When building the response for this booking, use the actual DB-inserted rows (with `id`/`transactionId`) for journal lines rather than the pre-insert computed objects — the OpenAPI response schema requires those fields, and reusing the computed-but-unsaved objects will pass TS but fail runtime response validation.

## Shared single vs. batch transaction validation
Transaction creation (single `POST /transactions` and batch `POST /transactions/batch`, used for offline-queue sync) share one `createTransactionEntry` helper that does all validation (ownership, payment-method rules, cash-register requirement/lookup, journal-line computation, insert, balance update, audit log) and throws a typed `HttpError` on failure. The batch route wraps each entry in try/catch and collects `created`/`errors` for partial success.

**Why:** Avoids drift between the two entry points' validation rules — a rule added to one always applies to the other automatically.
