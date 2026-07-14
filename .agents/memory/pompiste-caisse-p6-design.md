---
name: Pompiste = Caisse (P6) design
description: One-pump-attendant-one-cash-drawer architecture for STATION_SERVICE clients — schema, numbering, and isolation decisions.
---

# Un Pompiste = Une Caisse (Module P6)

Extends the existing P5 "Caisse Terrain" module (`cashRegistersTable`) rather than
introducing a new table. A POMPISTE hired under a STATION_SERVICE client gets a
dedicated `cashRegistersTable` row (`ownerUserId`, `syscohadaAccount`, `isActive`)
instead of sharing the client's general register.

**Why:** keeps `transactionsTable.cashRegisterId` as the single link used for
booking and balance tracking; avoids fragmenting reconciliation UI across two
concepts of "cash drawer".

## Sub-account numbering
Prefix `"5711"` + 2-digit sequence: `571101`, `571102`, ... Master/conceptual
account `571100` is seeded in the global chart of accounts for display only
(never posted to directly).

**Why:** the numbering helper scans *all* registers ever created for the client
(active or not), not just active ones, so a disabled/removed pompiste's number
is never reused — reuse would corrupt that account's historical ledger trail.

## No FK from usersTable to cashRegistersTable
`caisse.ts` already imports `usersTable`, so a forward FK would create a
circular schema import. Instead: `cashRegistersTable.ownerUserId` → `usersTable.id`
(one-directional FK, set null on delete) plus a plain denormalized
`usersTable.associatedCashAccountNumber` text column (no FK) for display.

**Why:** avoids restructuring the schema module graph for one relation.
**How to apply:** if a future feature needs the reverse relation from users to
registers, use `db.query.cashRegistersTable.findFirst({ where: eq(ownerUserId, ...) })`
rather than adding a users→registers relation.

## Global accountsTable upsert must use onConflictDoNothing
`accountsTable` is shared across all clients/tenants (unique on `accountNumber`).
When auto-syncing a pompiste's sub-account into the chart of accounts, always
`onConflictDoNothing` — never `onConflictDoUpdate` — so one client's employee
name can never overwrite another client's identically-numbered account label.

## Isolation enforcement (defense-in-depth)
- `GET /cash-registers` and single-register lookups: a portal-role user
  (`isPortalRole`) who owns a register only ever sees/operates their own —
  checked by querying `ownerUserId`, not by trusting the JWT (the JWT does not
  carry cash-account info).
- `createTransactionEntry` (shared by single + batch transaction creation)
  force-overrides `cashRegisterId` to the caller's owned register when one
  exists, ignoring/validating against whatever the client body sent. This is
  the authoritative enforcement point — more important than any frontend
  restriction, since a modified client request could otherwise pick another
  pompiste's register.
- The settlement route (`/transactions/:id/settle`) intentionally does **not**
  get the same override — pompistes are unlikely to have settlement
  permission; scope was limited to cash-entry creation.

## Journal-line posting to the personal sub-account
`computeJournalLines` (accounting-engine.ts) hardcodes account `571` for
`paymentMethod: "especes"`. A pompiste's cash sale must NOT post to the
generic `571` — it needs `treasuryAccountOverride: { accountNumber, label }`
passed in from the resolved owned register's `syscohadaAccount`. Without this
override, cash-register *balance* tracking would be correct but the actual
SYSCOHADA ledger entry would still land on the shared account, defeating the
whole point of separate sub-accounts. Any future payment-method or
cash-flow code path that posts on behalf of a register-owning user must apply
the same override.
