---
name: Client-portal role ownership scoping
description: Pattern for scoping a client-facing portal role (e.g. client_pme) to exactly one owned record across all resources.
---

When a role represents an external/client-side account that must only ever see its own record (not just its own tenant), scoping by tenant ID (e.g. `firmId`) alone is not enough — every list/get/write endpoint touching that resource family needs an explicit ownership check (e.g. `clientId` on the JWT payload compared against the resource's owning ID), and mutation endpoints for state the portal role shouldn't drive should be blocked by role, not just left unscoped.

**Why:** it's easy to add a new resource or endpoint later and forget the ownership check since tenant scoping already "looks" secure (queries are filtered), silently leaking cross-client data within the same tenant to a portal user who bypasses the intended list results by requesting another ID directly.

**How to apply:** whenever adding a new endpoint that a client-portal-style role can reach, ask "does this filter by both tenant AND owner id?" and "can this role mutate state it shouldn't own?" — add both checks up front rather than retrofitting after a report.
