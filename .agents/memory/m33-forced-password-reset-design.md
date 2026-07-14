---
name: M33 Enforced Temporary Password Reset design
description: How the forced first-login password reset flow (restricted JWT scope, temp password generation) is wired for cabinet staff and PME users.
---

Module M33 forces any admin-created account (cabinet `/users`, PME `/staff`) to replace an
auto-generated temporary password before it can use the app.

- The server, not the admin, always generates the temp password (`generateTemporaryPassword`
  in `lib/auth.ts`); it's returned once in the create response as `temporaryPassword` and
  stored in `temporaryPasswordPlain` until resolved. `password` was removed entirely from
  `CreateUserBody`/`CreateStaffBody`.
- `/auth/login` checks `user.requiresPasswordChange`: if true, it returns
  `{status: "FORCE_PASSWORD_CHANGE", token}` where `token` has `scope: "password_reset_only"`
  (15m, via `signRestrictedPasswordResetToken`) instead of a normal session.
- `requireAuth` rejects any restricted-scope token on every normal route (403,
  `FORCE_PASSWORD_CHANGE`); only `requirePasswordResetAuth` (gating
  `POST /auth/reset-first-password` exclusively) accepts it.
- **Reuse gotcha**: the JWT scope check alone does not stop the same restricted token from
  resetting the password twice within its 15-minute lifetime — the handler must also check
  `user.requiresPasswordChange` in the DB and reject with 400 if already false. Found via
  live curl testing (the second reset silently overwrote the first with a different password
  and broke login) — always test **token reuse**, not just the happy path, for any
  single-use-token flow.
- Frontend: `useAuth`'s `/auth/me` query must be disabled (and its "invalid token" cleanup
  effect suppressed) while on the `/force-password-change` route, or the restricted token
  gets deleted on page load before the user can submit the reset form (Shell also needs that
  route added to its public-routes allowlist so it doesn't bounce to `/login`).
