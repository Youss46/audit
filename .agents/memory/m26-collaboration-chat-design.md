---
name: M26 collaborative review & contextual chat design
description: Design decisions behind the thread/comment split table, WebSocket-as-enhancement, and notification routing for the collaborative-review/chat module.
---

## Thread/comment split table
Contextual comments on a ledger line, GED document, or tax declaration are modeled as two tables, not one:
- `collaboration_threads` — one row per `(firmId, targetType, targetId)`, holding `isResolved`/`resolvedById`/`resolvedAt`.
- `contextual_comments` — the individual messages, `threadId` FK.

**Why:** thread-list views (comment-count badges, "unresolved only" filters, last-message previews) need to scan threads, not every comment. A single flat comments table would force a `GROUP BY` per render. A new comment on a resolved thread auto-reopens it (flips `isResolved` back to false) rather than requiring a separate "reopen" action.

**How to apply:** if adding a new commentable target type, add it to the `targetType` enum and teach the server's `resolveTargetOwner()` helper to resolve `firmId`/`clientId`/a label from the target's own table — never require the caller to pass `clientId` redundantly.

## WebSocket push is an enhancement, not the transport
A lightweight `ws`-based layer sits on the existing HTTP server (`http.createServer(app)` + a `ws` upgrade at a dedicated path, authenticated via `?token=<JWT>` query param since browsers can't set headers on the WS handshake).

**Why:** Replit's path-based proxy behavior for WebSocket upgrades on a nested artifact path wasn't verified in advance, and proxies/networks can drop long-lived connections. Treating it as best-effort avoided blocking the feature on that unknown.

**How to apply:** every socket-driven UI (notification bell, thread views) must also have a polling/refetch fallback (e.g. `refetchInterval` on the notifications query) so the feature works even if the socket never connects. On receipt of a push message, just invalidate the relevant React Query cache keys — don't try to merge the payload into cache by hand.

## Notification routing must match the recipient's role
A cabinet-authored comment notifies the client's portal user(s); a client-authored comment notifies the firm's accountants. The `linkToRoute` on each notification must point at a route the *recipient's own role* can actually load — e.g. client recipients get `/portal`, cabinet recipients get `/cabinet/client/:id/revision?...`. It's easy to accidentally swap these when writing the branch that computes `linkToRoute` next to the branch that computes recipients, since both are keyed off the same `isClientAuthor` boolean but with inverted logic. Caught and fixed once already — double-check this specific inversion when touching notification-routing code.
