---
name: API server doesn't hot-reload after openapi.yaml/orval codegen
description: New zod-schema fields silently vanish from API responses until the API server workflow is restarted after running the orval codegen step.
---

After editing `lib/api-spec/openapi.yaml` and running
`pnpm --filter @workspace/api-spec run codegen` (orval + typecheck:libs), the
already-running `artifacts/api-server` dev workflow keeps serving responses
parsed against the *old* zod schema — new fields you just added get silently
stripped from the JSON response (zod's default "strip unknown keys" behavior
looks the same whether the field is unknown or just stale-schema-missing, so
this fails silently, no error).

**Why:** the dev workflow's running Node process doesn't pick up
regenerated files in `lib/api-zod/src/generated` on its own; it needs a
process restart to re-evaluate them even though the package resolves to
TS source (not a prebuilt dist).

**How to apply:** always restart the `artifacts/api-server` workflow after
any `openapi.yaml` change + codegen run, before testing the new response
shape — otherwise you'll wrongly conclude the codegen or route code is
broken.
