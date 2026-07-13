---
name: Reusing an "anomalie" status across modules
description: How the SYSCOHADA visa checklist and the PME transaction ledger both use an "anomalie" status but mean different things by it.
---

The mission/checklist module (M4) and the transaction/ledger module (P3/M3) both have a status
value literally named `anomalie`, but they are unrelated enums on unrelated tables and mean
different things:

- `ChecklistItemStatus.anomalie` — a control point failed review during the visa checklist walkthrough.
- `TransactionStatus.anomalie` — a PME's plain-language cash entry was sent back by the cabinet
  ("Invalider") with a clarification note, and needs to be corrected/resubmitted. There is no
  separate "rejected" state; `anomalie` doubles as that state, and the note lives in
  `transactions.clarificationNote`.

**Why:** when P3/M3 was designed, the open question was whether "sent back for correction" needed
a 4th transaction status. Reusing `anomalie` (rather than adding `rejette`/`rejected`) kept the
enum small and matched the "this needs attention" semantics used elsewhere in the app.

**How to apply:** don't assume `anomalie` means the same thing across modules just because the
string matches — check which table/enum it's scoped to. If a future module needs a third
"needs correction, distinct from a first-time submission" status, extending `TransactionStatus`
rather than overloading `anomalie` further is worth reconsidering.
