---
name: Capitaux Propres (Classe 1) equity lifecycle — capital + closing gaps
description: What was actually missing when finishing a partially-built SYSCOHADA equity module (capital contribution + year-end closing).
---

The closing engine (M19) and the basic capital-contribution posting (Dr 5211/Cr 1013) were already fully built. The real gaps were narrower than they looked:

1. **4613 fallback never existed.** There was no schema field to represent "capital souscrit but not yet deposited in bank" — added `clientsTable.capitalDeposited` (boolean, default true). `capital-engine.ts` now branches: true → Dr 5211/paymentMethod "virement", false → Dr 4613/paymentMethod null (no real treasury movement yet).

2. **The capital entry was silently misclassified as journal BQ, not OD.** `getJournalCode()` in the frontend (`artifacts/m15-audit/src/lib/status.ts`) has an `OD_JOURNAL_SOURCES` allow-list checked *before* the paymentMethod-based fallback. `"capital_constitution"` was missing from that set, so because the entry's paymentMethod was "virement", every capital-constitution entry displayed under Journal BQ instead of OD. Any new source that should always land in OD must be added to this set explicitly — paymentMethod-based inference will otherwise override it.

3. **The client edit form (`client-detail.tsx`) had `editCapitalSocial` state wired into the update mutation payload, but no actual input rendered for it** — capital could only ever be set at creation time (`client-new.tsx`), never adjusted afterward, even though the backend PATCH path already supported triggering the constitution entry on first update. When state exists but UI does not, always grep the render body for the field name before assuming a form is complete.

4. **Chart-of-accounts seed (`seed-accounts.ts`) never had the specific equity/closing account codes** (5211, 1013, 4613, 1301, 1309) that the engines reference by literal string — only broad placeholders like "101" and "521" existed. Reports (Bilan/Compte de Résultat) aggregate by `accountClass` (first digit) with a numeric fallback, so they never broke, but account *names* fell back to the bare number anywhere a name lookup was expected (Grand Livre, Journaux). Added the missing rows.

5. **`PeriodLockedError`'s shared message** ("L'exercice ... est définitivement clôturé...") is reused across every write-guard (accounting, fixed-assets, payroll, etc.) and is intentionally generic. For the close-period *action* itself, added an explicit pre-check in `routes/closing.ts` that returns a dedicated 409 message ("Cet exercice est déjà clôturé et verrouillé.") instead of relying on the shared error text — keep this pattern when a shared guard's wording doesn't fit a specific user-facing action.

**How to apply:** when told "I already started this, check what's missing," don't just check the core engine functions exist — check (a) every literal account code referenced actually exists in the seed, (b) every new transaction `source` is correctly classified everywhere sources are branched on (journal code, report grouping), and (c) every state variable declared in a form actually has a rendered input.

## Reprise de dossier (existing-client onboarding, no capital entry)

Added a third path alongside the 5211/4613 capital-contribution branches: `clientsTable.isReprise` (boolean, default false). When true, capital initialization skips journal posting entirely — `markCapitalAsReprise()` in `capital-engine.ts` just flips `isCapitalInitialized = true` directly, sharing the same `CapitalAlreadyInitializedError` idempotency guard as the posting path so a single `initializeClientCapital()` dispatcher (in `routes/clients.ts`, used by both POST and PATCH) can branch on `isReprise` without duplicating the guard logic. Historical equity for these clients is expected to arrive via a separate global Balance d'Entrée / À-nouveaux import, not a fabricated constitution entry dated today. Gave this its own audit action (`CAPITAL_REPRISE`) distinct from `CAPITAL_INIT` so the audit trail doesn't conflate "entry posted" with "marked initialized, no entry" — worth doing whenever a workflow gains a "skip the automation, we're backfilling manually" toggle.
