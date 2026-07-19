---
name: Sector-restricted staff roles (POMPISTE / AGENT_TERRAIN)
description: Design decisions for business-sector-aware role routing introduced for STATION_SERVICE clients.
---

## Rule
`POMPISTE` is shown only when the client's sector is `STATION_SERVICE`; `AGENT_TERRAIN` is shown for every other sector. Filtering happens server-side in `GET /roles` (`artifacts/api-server/src/routes/staff.ts`) — the frontend just consumes the filtered list.

## How the filter works
In `GET /roles` (client_pme only), the handler looks up the requesting user's `clientId` → `clientsTable.sector`, then excludes `AGENT_TERRAIN` for STATION_SERVICE or `POMPISTE` for everything else via a Drizzle inline `ne(t.code, excludedCode)` predicate. No query-param needed — the scoping is implicit from the JWT.

## roleCode in the JWT
`roleCode` (stable machine key, e.g. `"POMPISTE"`) was added to `serializeUser` in `auth.ts` and to the OpenAPI `User` schema. The frontend uses `user.roleCode` (not `roleLabel`) for conditional rendering, since labels can be relabelled without code changes.

## Dashboard branching (portal.tsx)
`client_staff` users land on `/portal`. The portal renders a role-specific quick-actions card:
- `roleCode === 'POMPISTE'` → amber card (Fuel icon) with "Relevé d'index de pompe" + "Ventes de carburant" buttons → `/caisse`
- `roleCode === 'AGENT_TERRAIN'` → blue card (MapPin icon) with "Saisir un mouvement de caisse" + "Déclarer une opération" buttons → `/caisse` / `/mes-operations`

## Sector in client form (client-new.tsx)
`STATION_SERVICE` added to the `Sector` enum in the OpenAPI spec and the Zod schema in `client-new.tsx`. Selecting it triggers an amber info banner: "Ce dossier bénéficiera du rôle Pompiste…". SYSCOHADA thresholds for STATION_SERVICE mirror `commerce` (both backend and frontend visa-engine).

## Seed
5 roles now seeded: ADMIN, COMMERCIAL, AGENT_TERRAIN, POMPISTE, COMPTABLE_INTERNE. Old `POMPISTE` label was "Agent Terrain / Pompiste" (dual-purpose) — now split into two distinct roles with separate descriptions. Re-run `pnpm --filter @workspace/db run seed:roles` after any pull.

**Why:** a single "Agent Terrain / Pompiste" label was confusing for non-station-service PME owners who don't operate pumps. Splitting makes the role catalog self-documenting and lets the UI surface contextually relevant roles only.

**How to apply:** any new sector-specific role follows the same pattern: add the sector to `SECTORS` in `clients.ts`, add the role code to `SYSTEM_ROLE_CODES` in `roles.ts`, seed it, add a filter case in `GET /roles`, add a dashboard branch in `portal.tsx`.
