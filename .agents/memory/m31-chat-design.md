---
name: M31 internal cabinet chat (Messagerie Interne) design
description: Architecture substitutions made when the user's literal spec (NestJS, dedicated WS gateway, UUID PKs, Staff_Users table) conflicts with this project's established stack conventions.
---

When a feature spec is written against a different stack than the project
actually uses (e.g. a generic "Slack clone" brief calling for NestJS + a
dedicated WebSocket gateway + UUID PKs + a separate `Staff_Users` table),
substitute the equivalent using the project's existing conventions rather
than introducing a second stack inside one app. This mirrors the pattern
already established for M17–M29.

**Why:** a second framework/gateway/ID-scheme living alongside the real one
multiplies operational surface for no functional gain — the business
requirement is "internal chat for staff," not "use NestJS."

**How to apply, concretely (this project):**
- Multiplex new real-time event types onto the *existing* single WebSocket
  hub (one `wss` per app, one `/api/ws` path) instead of standing up a
  second gateway. Presence tracking (who's online, scoped per firm) can be
  layered onto the same connection/close handlers already there — no extra
  DB round-trip needed if the JWT payload already carries the tenant id.
- "Staff" as a concept doesn't need its own table when the app already has
  a unified `users` table with a role column and an `isPortalRole()`
  helper — staff is simply the negation of that helper. Introducing a
  parallel `Staff_Users` table would fork the single source of truth for
  who a user is.
- For attachments, reuse whatever pattern already exists elsewhere in the
  app (here: base64-in-Postgres, not object storage) rather than adding a
  second attachment mechanism. A stateless "validate and echo back" upload
  endpoint (no persistence) lets the frontend do an attach-then-send flow
  without multipart uploads, which this project's codegen pipeline can't
  express cleanly anyway (see orval-zod-openapi-gotchas.md).
- Serial integer PKs throughout, consistent with every other table in the
  schema, not UUIDs.
