---
name: orval-zod-openapi-gotchas
description: Pitfalls when writing OpenAPI specs for the Orval + zod (pinned v3.25) + drizzle-zod codegen pipeline in this workspace's pnpm-monorepo template.
---

## `format: email` breaks codegen typecheck

Orval emits `zod.email()` (the zod v4-preview top-level API) for any OpenAPI
field with `format: email`, but the workspace's pinned `zod` is v3.25.x
imported via the plain `"zod"` specifier (v3 API, no top-level `.email()`).
This fails `tsc --build` with `TS2339: Property 'email' does not exist`.

**Why:** the generated `lib/api-zod` package imports `import * as zod from
'zod'`, not `zod/v4`, so it only gets the v3 API surface.

**How to apply:** avoid `format: email` in `openapi.yaml`; use a plain
`type: string` (optionally with `minLength`) instead. Do real email
validation with a regex/pattern if needed, or client-side.

## Mixing path params + query params on one operation causes a name collision

If an OpenAPI operation has both a path parameter and a query parameter
(e.g. `GET /clients/{id}/documents?category=...`), Orval names the query
params TS interface (in `lib/api-zod/src/generated/types/`) the same as the
path params Zod object it generates inline in `api.ts`
(`<OperationIdPascal>Params`), producing `TS2308: ... already exported a
member named ...` in the barrel `index.ts`.

**Why:** Orval's naming convention for the zod-output query-params type
doesn't add a distinguishing suffix when the operation ID is the same base
name as the path-params zod object.

**How to apply:** avoid combining path + query params on the same operation
in this codegen setup — drop the query param (filter client-side) or split
into a separate endpoint. Confirmed to NOT happen for query-only or
path-only operations.

## `format: date-time` on a *query param* breaks it at runtime (not just typecheck)

Orval emits `zod.date()` for a query parameter typed `{ type: string, format:
date-time }`. Unlike path/query `integer` params (which Orval emits as
`zod.coerce.number()`), there's no coercion for dates -- `zod.date()` requires
an actual `Date` instance and rejects every real query string with a 500
`ZodError` ("expected date, received string"). This one passes typecheck
and codegen cleanly, so it isn't caught until the endpoint is called -- it
surfaces to users as a page stuck on a loading spinner (react-query retries
the failing request a few times before giving up).

**Why:** query params are always strings on the wire; Orval's date-time
handling assumes the caller already has a `Date`.

**How to apply:** for query params carrying a date/date-time, use a plain
`{ type: string }` (no `format`) in `openapi.yaml`, then parse it into a
`Date` manually in the route handler (`new Date(params.foo)`). Reserve
`format: date-time` for request/response *body* fields, where this doesn't
occur.

## File uploads: use base64 JSON, not multipart/format:binary

`type: string, format: binary` in a multipart/form-data request body makes
Orval emit `zod.instanceof(File)` / `Blob` in the generated zod schema,
which doesn't typecheck in a Node-only lib package (no DOM lib) and fails
`tsc --build` with `Cannot find name 'File'/'Blob'`.

**How to apply:** model file upload endpoints as `application/json` with a
plain `fileData: string` (base64-encoded) field instead. Frontend reads the
file via `FileReader` before calling the generated mutation hook.
