---
name: M15-AUDIT multi-station (P8) rollout
description: What the multi-station upgrade added on top of prior P8 groundwork, and a gotcha with Express type augmentation drifting from the JWT payload type.
---

Prior "Module P8" work (stations table, nullable `stationId` on users, station CRUD, pompiste-screen scoping) already existed but wasn't recorded in memory before this task — caused redundant re-exploration. Lesson: when a spec sounds greenfield, grep for the domain noun (e.g. "station") across schema/routes/pages before assuming nothing exists.

This task's additions on top of that groundwork:
- `transactionsTable.stationId` (nullable FK, `onDelete: set null`) so journal entries can be tagged and filtered per station in reports.
- `pumpsTable.stationId` tightened from nullable to `.notNull()` — every pump must now belong to a station.
- Report/export routes (`/reports/balance`, `/bilan`, `/compte-resultat`, `/grand-livre`, `/pilotage`, and their exports) all accept an optional `stationId` query param that narrows the underlying ledger-line query.
- A shared `StationSelector` component (`artifacts/m15-audit/src/components/stations/station-selector.tsx`) renders a "Toutes les stations" dropdown only for cross-station callers (`shouldShowStationSelector` checks `!user.stationId && stations.length > 1`); station-scoped users (pompiste, station manager) never see it since their JWT `stationId` already forces server-side scoping.
- Wired the selector into the two screens that actually match "global dashboard" / "Révision Recettes-Dépenses" in spirit: `pilotage.tsx` (Tableau de Bord Dirigeant) and `comptabilite-cabinet.tsx` (only when scoped to a single client via `/comptabilite/:clientId/saisie` — the unscoped all-clients queue has no single station list to offer). The plain mission-tracker `dashboard.tsx` was deliberately left alone: missions aren't station-scoped data, so a selector there would filter nothing.

**Gotcha:** `AuthTokenPayload` (lib/auth.ts) and the Express `Request.user` type augmentation (`types/express.d.ts`) are two separate type declarations that must be kept in sync by hand — adding a field to one without the other produces `req.user!.stationId` TS errors that look like a logic bug but are just a missed augmentation.

**Open design question left to the user:** station-scoped Cash (57)/Mobile Money (55) accounts are not split per station — multi-station isolation is done via report-level `stationId` filtering only, to avoid conflicting with the existing P6 per-pompiste sub-account design. Revisit if a client needs true per-station treasury sub-accounts.
