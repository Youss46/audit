---
name: M29 RBAC & staff management design
description: How restricted staff accounts (client_staff) were bolted onto an existing users table, and the permission-gating pattern used across routes.
---

- No separate `Staff_Users` table (even though the original spec asked for one). Reused the unified `users` table with a new `role="client_staff"` value plus a nullable `roleId` FK into a new global `roles` catalog table (`code`, `label`, `description`, `permissions` jsonb array, `isSystem`). Keeps every existing per-user query/relation working unmodified.
  - **Why:** the codebase already scopes everything off a single `users` table (firmId, clientId columns); a parallel staff table would have required duplicating every ownership/scoping check.
- Permission taxonomy is a flat string array (`dashboard.view`, `operations.view/create`, `caisse.view/create`, `pilotage.view`, `facturation.view/create`) stored per role, resolved once at login and embedded directly in the JWT — not re-fetched per request.
  - **Why:** matches the existing session model, where role/permission changes already require a fresh login to take effect (no live permission invalidation elsewhere either).
- `requirePermission(...)` middleware only ever restricts when `req.user.role === "client_staff"`. Every other role (cabinet staff, and the `client_pme` owner itself) bypasses the check unchanged.
  - **How to apply:** when adding a new permission-gated route, don't gate cabinet-only or owner-only actions this way — those still use `requireRole(...)`. `requirePermission` is purely an additional restriction layered on top of the portal's existing `isPortalRole`/`clientId` scoping.
- Staff management (create/edit/delete staff) is gated by the literal role `client_pme`, never by a permission flag.
  - **Why:** deliberately avoids privilege escalation — if "manage staff" were a permission, an Administrateur-role staff account could grant itself more access. Only the actual dossier owner account can manage staff.
- Frontend cannot import `@workspace/db`, so `isPortalRole()` and a `hasPermission()` check are duplicated in the frontend's `lib/status.ts` as plain mirrors of the backend logic. Keep both in sync manually when the permission taxonomy changes.
- `/transactions` and `/cash-registers` routes accept **either** `operations.*` or `caisse.*` permissions, since both Mes Opérations and Caisse Terrain UI (and Caisse Express offline sync) hit the same endpoints.
- Found and fixed a pre-existing bug while testing this: `artifacts/api-server/src/routes/invoicing.ts` referenced `usersTable` columns `firstName`/`lastName` that don't exist (the schema only has `fullName`), which made every invoice-list/detail query throw a Drizzle "no fields selected" 500. Worth checking for `firstName`/`lastName` remnants if invoicing-related code is touched again.
