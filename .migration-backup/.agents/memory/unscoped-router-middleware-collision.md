---
name: Unscoped router.use(requireRole) blocks unrelated later routes
description: Express gotcha in this API server where a sub-router's role-gate middleware without a path prefix silently 403s requests meant for other routers.
---

In `artifacts/api-server/src/routes/index.ts`, every module router is mounted with `router.use(xRouter)` (no path prefix) — each router's own route paths (e.g. `/cabinet/...`) provide the actual scoping.

If a router adds a blanket `router.use(requireAuth); router.use(requireRole(...))` (no path argument) instead of attaching `requireRole(...)` per-route, that role check runs for **every** request that reaches that router in the chain — including requests ultimately destined for a *different, later-mounted* router — because Express keeps walking mounted routers in order until one replies, and an unscoped `.use()` middleware fires regardless of whether this router has a matching route for the URL.

Concretely: `cabinet.ts` had `router.use(requireRole("expert_comptable","collaborateur","stagiaire"))` with no path. Any `client_pme`/`client_staff` request for an unrelated path (e.g. `GET /roles`, owned by `staff.ts`, mounted later) that didn't match any router before `cabinet.ts` got a 403 from `cabinet.ts`'s blanket gate before ever reaching `staff.ts` — symptom: an empty role dropdown in the "Ajouter un collaborateur" UI with no visible error.

**Why:** losing time hunting through the target router/frontend when the actual 403 is coming from an unrelated, earlier-mounted router's unscoped gate.

**How to apply:** when a role/permission check on one endpoint seems to block a *different* endpoint, or an authorized user gets an unexplained 403, log/inspect `requireRole`'s `roles` + `req.path` to see which router's gate actually fired — then check whether that router's `.use()` calls are scoped to its own path prefix (`router.use("/cabinet", requireRole(...))` or per-route) rather than the whole router.
