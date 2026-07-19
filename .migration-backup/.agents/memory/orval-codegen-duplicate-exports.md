---
name: Orval codegen duplicate exports
description: Orval regenerates index barrel files with duplicate export lines on every codegen run, causing tsc --build to fail with TS2308.
---

## The problem

Every `pnpm run --filter @workspace/api-spec codegen` run (which calls `orval && pnpm -w run typecheck:libs`) regenerates `lib/api-zod/src/index.ts` and `lib/api-client-react/src/index.ts` with **duplicate `export *` lines**:

```ts
// lib/api-zod/src/index.ts after orval runs
export * from "./generated/api";
export type * from "./generated/types";
export * from './generated/api';        // ← duplicate
export * from './generated/types';      // ← duplicate (also not export type *)
```

This causes `tsc --build` to fail with `TS2308: Module already exported a member named 'X'` for any name that exists in both `./generated/api` (as a Zod schema value+type) and `./generated/types` (as a TypeScript interface).

**Why:** Orval writes these barrel files fresh on every run; the duplicate lines are baked into Orval's output template for this project configuration.

**Workaround (manual, after every codegen):** Manually deduplicate both files:
- `lib/api-zod/src/index.ts` → keep only `export * from "./generated/api"` + `export type * from "./generated/types"`
- `lib/api-client-react/src/index.ts` → keep only unique lines (remove the two duplicate `export *` at the bottom)

**Impact on builds:** The API server uses esbuild (not tsc) so it is **unaffected** by this typecheck error — the server builds and runs correctly even when typecheck:libs fails. The frontend (Vite) is also unaffected. Only `pnpm run typecheck:libs` / `pnpm run build` (workspace-level) fails.

**How to apply:** After any codegen run, fix the two barrel files before running `pnpm run typecheck:libs`. Task #2 tracks the permanent fix (orval config or post-codegen script).
