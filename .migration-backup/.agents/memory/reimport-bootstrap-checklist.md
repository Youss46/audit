---
name: Re-import bootstrap checklist
description: Steps needed to get a previously-built pnpm-workspace project running again after a GitHub re-import.
---

When a project is re-imported from GitHub into Replit, code and `artifact.toml` files come back intact, but the *environment* around them does not:

- No workflows are configured yet, even though each artifact already has a valid `.replit-artifact/artifact.toml`. Simply reading/touching the artifacts (e.g. via the artifacts skill) is enough for the platform to auto-register the managed workflows — no manual `configureWorkflow` or TOML edit needed. Then use `WorkflowsRestart` with the exact managed name (e.g. `artifacts/api-server: API Server`).
- `node_modules` is gone — run `pnpm install` at the repo root first.
- The database is provisioned (env var present) but **empty** — `drizzle-kit push` recreates the schema/tables but does not restore data. Any project that relies on seed scripts (roles, chart-of-accounts, mapping rules, demo accounts) needs those re-run explicitly (check `lib/db/package.json` for `seed:*` scripts) or the app will look broken (e.g. no roles in a dropdown, no login-able account) despite the code being 100% intact.

**Why:** losing an hour to "why is this feature missing" on a fully-built app is almost always missing seed data, not a code regression — check seeds before debugging application code after a re-import.

**How to apply:** on any "set up the imported project" task for a pnpm-workspace repo that already has `artifacts/*/.replit-artifact/artifact.toml` files, run through: install → let workflows auto-register → db push → run every `seed:*` script → restart workflows → screenshot to confirm.
