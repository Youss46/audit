---
name: Pump-to-pompiste assignment restriction (P7 hardening)
description: How the daily pump↔pompiste assignment feature restricts pump selection on "Relevé d'index", including the server-side enforcement and a router-mounting gotcha.
---

- `pumpAssignmentsTable` (clientId, pumpId, staffUserId, shiftDate as "YYYY-MM-DD" text) links a pompiste to a pump for one service day. PME owner (`client_pme`) creates/deletes; a pompiste only ever reads its own via `GET /pump-assignments/my`.
- Frontend (`pump-index.tsx`, "Relevé d'index"): auto-selects + locks the pump dropdown when the pompiste has exactly one assignment for today; filters the dropdown to assigned pumps only when there are several. This was already built correctly — don't re-implement, check first.
- **Server-side enforcement is the part that's easy to skip**: `POST /pump-shifts` must independently re-check `pumpAssignmentsTable` for `client_staff` callers (resolve the submitted `pumpLabel`+`fuelType` to a `pumpId`, then look up an assignment row for that user/pump/today) and 403 otherwise — the frontend filter alone doesn't stop a tampered request. Every other role (owner, cabinet staff) bypasses this check, matching the rest of the module's `isPortalRole`/`requirePermission` scoping.
- **Why:** a route file can be fully implemented (CRUD + OpenAPI + generated hooks) yet never be reachable if nobody added `router.use(...)` for it in `routes/index.ts` — always grep the mount list, not just the route file, before assuming an "already built" feature actually works end-to-end.
- **How to apply:** when a feature looks pre-built, verify all three layers before trusting it: (1) router mounted in `routes/index.ts`, (2) the mutating endpoint re-validates server-side rather than trusting client-side filtering, (3) a manager-facing UI actually exists to populate the restricting data (here: an owner screen to create assignments) — a restriction with no way to grant access is unusable.
