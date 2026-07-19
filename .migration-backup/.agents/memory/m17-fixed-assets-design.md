---
name: M17 fixed assets & depreciation engine design
description: Key design decisions for the fixed assets module (M17)
---

# M17 Fixed Assets & Depreciation Engine

## Rule
generate-closings does a direct DB insert (bypassing createTransactionEntry);
query hooks require explicit queryKey alongside enabled flag.

**Why:** createTransactionEntry enforces PME-entry validation rules (payment method,
category, document) that don't apply to non-cash adjusting entries like dotations.
Direct insert keeps status "a_valider" so the accountant reviews before locking.

## ClientAccountingNav integration
Immobilisations tab routes to /cabinet/client/:id/immobilisations (same pattern as cloture).
CABINET_TABS = Set{"immobilisations","cloture"} controls the routing branch in tabUrl().
handleClientChange uses tabUrl(activeTab, newClientId) so switching clients preserves the current tab.

## Route detection in ClientAccountingNav
Three useRoute() calls are needed: /comptabilite/:clientId/:tab, /cabinet/client/:clientId/cloture,
/cabinet/client/:clientId/immobilisations. First non-null wins.

## SYSCOHADA account picker
Create form has a catalogue mode (Select with 18 preset Class 2 accounts with standard
usefulLife + depreciationType) and a custom mode (free-text input). Selecting a preset
pre-fills label, depreciationType, usefulLifeYears. User can toggle to custom.

## Schedule endpoint ordering
Express /:id/schedule does NOT conflict with /:id because params don't match slashes.
Route registration order is safe regardless of declaration order.

**How to apply:** Any new cabinet-only tab (not under /comptabilite/) must be added
to CABINET_TABS in ClientAccountingNav so routing and client-switching work correctly.

## Class 2 auto-sync bridge (validation → fixed assets registry)
A validated transaction's Class 2 debit lines (accounts starting "2", excluding "27x")
auto-create pending-setup asset stubs (`depreciationType`/`usefulLifeYears` null,
`pendingSetup: true`) in the accounting approve route.

**Why:** an invoice initially booked to a generic expense account (e.g. 628) only becomes
a fixed asset once the accountant redirects its journal-line account to a Class 2 code via
the M3 "ajuster les comptes" (PATCH journal-lines) feature, then approves — that's the real
trigger path, not a dedicated "buy an asset" form.

**How to apply:** the new asset's `label` must come from the transaction's own label first,
falling back to the journal line's label only if empty — the line's label is usually just
the generic counterpart-account name (e.g. "Autres charges externes") and is useless in the
registry. Getting this fallback order backwards makes every auto-synced asset show a
meaningless label.

## Corrected dotation account mapping (SYSCOHADA révisé)
The debit-account mapping originally shipped was wrong (class 21→6812, everything
else→6811). Correct mapping: class "20" (charges immobilisées) → 6811, class "21"
(incorporelles) → 6812, everything else / classes 22-24 (corporelles) → 6813.

**Why:** 6813 is the SYSCOHADA charge account for dotations on tangible assets
(most real-world assets: vehicles, equipment, furniture); 6811/6812 are minority
cases. Getting this backwards misclassifies almost every dotation entry.

## Prorata temporis basis is 360 days, not 365
`prorataDaysInAcquisitionYear` and both schedule builders (linear, dégressif) must use
a 360-day year of twelve 30-day months, not actual calendar days / 365.

**Why:** SYSCOHADA's "année commerciale" convention caps every day-of-month at 30 and
every year at 360 days — a genuine domain rule, not an approximation. Calendar-day math
silently produces off-by-a-few-days dotation amounts that don't match cabinet expectations.

## Anti-duplicate posting table + OD journal classification
`asset_depreciation_postings` (assetId, fiscalYear, transactionId; unique on
assetId+fiscalYear, no FK to transactionsTable to avoid a schema import cycle) is the
per-(asset, year) boundary generate-closings checks before posting — mirrors the
single-flag `postedTransactionId` pattern used elsewhere, but this one recurs per year.
When every otherwise-eligible asset is already posted and nothing new generates, the
route returns 409 so the frontend can show a specific "already booked" toast instead of
silently reporting zero generated entries.

Dotation transactions (and other non-treasury adjusting sources: closing_result,
a_nouveaux, vat_liquidation) have `paymentMethod: null`, which the frontend's
`getJournalCode()` in `lib/status.ts` previously had no branch for — they fell through
to "HA" by default. Added an explicit "OD" (Opérations Diverses) journal code, keyed off
`source` (preferred) with a `paymentMethod == null` fallback, everywhere the journal code
is derived and rendered (comptabilite-journaux.tsx filters/colors/section order).
