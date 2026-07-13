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
