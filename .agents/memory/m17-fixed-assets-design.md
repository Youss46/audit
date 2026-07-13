---
name: M17 Fixed Assets & Depreciation Engine Design
description: Key decisions for Module M17 — Gestion des Immobilisations & Amortissements
---

## Design decisions

**Depreciation engine is a pure lib** (`artifacts/api-server/src/lib/depreciation-engine.ts`) with no DB access. Functions:
- `buildDepreciationSchedule` — full schedule (LINEAIRE straight-line with prorata in days/365, DEGRESSIF with SYSCOHADA coefficients ≤2yr→1.0, ≤4yr→1.5, ≤6yr→2.0, else→2.5; auto-switch to linear when linear annuity ≥ declining-balance annuity).
- `getCumulativeDepreciation(params, year)` — used in GET /assets list endpoint.
- `getAnnuityForYear(params, year)` — used in generate-closings.
- `deriveAmortissementAccount` — SYSCOHADA credit side: `"28" + account[1] + account[2..4]`.
- `deriveDotationAccount` — "6812" for Class 21 (incorporelles), "6811" otherwise.

**Why:** Keeps the calculation logic testable and decoupled; the engine doesn't know about multi-tenancy.

**Generate-closings bypasses createTransactionEntry** — depreciation is a non-cash adjusting entry (no treasury movement). It does a direct DB insert into `transactionsTable` with `paymentMethod: null` and `paymentType: "cash"`, `status: "a_valider"`. This is safe because the DB schema allows `paymentMethod` to be null. The constraint that "cash requires paymentMethod" only lives in the validation layer of createTransactionEntry, not in the DB.

**Why:** Same pattern as settlement transactions. Avoids polluting the category-based accounting engine with special-case non-cash entries.

**Orval-generated query hooks require explicit queryKey** — when passing `enabled` to a generated React Query hook, you must also pass `queryKey`. TypeScript enforces this because `UseQueryOptions` has `queryKey` as required in TanStack Query v5. The pattern across all pages is:

```tsx
useListAssets(params, { query: { enabled: !!clientId, queryKey: getListAssetsQueryKey(params) } })
```

**Why:** TanStack Query v5 changed `queryKey` from optional to required in `UseQueryOptions`. Orval defers to the TanStack type directly.

**Route ordering for generate-closings** — `POST /assets/generate-closings/:clientId/:year` is registered before `GET /assets/:id` in the router. No actual conflict because HTTP methods differ, but the explicit ordering prevents future confusion if someone adds a GET variant.

**No `zod` package in api-server** — the api-server package does not have `zod` as a direct dependency; all Zod validation is done through `@workspace/api-zod` (the generated schemas). Do not `import { z } from "zod"` in route files.

**Zod coercion for path params** — `@workspace/api-zod` generates `zod.coerce.number()` for integer path params, so `req.params` strings are safely coerced to numbers. No manual `parseInt` needed.
