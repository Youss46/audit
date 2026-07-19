---
name: RBAC "read but annotate" role pattern
description: How to model a role that can read a resource and add commentary but not change its validated state.
---

When a role should have read-only access to a resource but still be allowed to attach a note/comment/observation (e.g. an intern/trainee reviewing but not approving a checklist), don't split this into a separate endpoint. Instead:

- Keep the role in the route's `requireRole(...)` allow-list (so it can reach the handler at all).
- Add an inline check inside the handler that inspects which fields the request body actually touches, and 403s only when a restricted field (e.g. `status`) is present — allow the request through when only the permitted field (e.g. `note`) is set.

**Why:** A single PATCH endpoint often mixes a "content" field (freely editable) with a "state" field (gated). Splitting by HTTP route/role-list alone can't express "this role may write field A but not field B on the same resource" — the allow-list only gates reachability, not per-field mutation rights.

**How to apply:** Any time a role spec says "can view/comment but not validate/approve/finalize" on a resource that has both a note-like field and a status-like field in the same update payload, use this allow-list + inline-field-check combination rather than inventing a second endpoint.
