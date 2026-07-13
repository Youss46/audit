---
name: Drizzle nullable column — $inferInsert type gap
description: >
  When a Drizzle column is made nullable (remove .notNull()), the $inferInsert
  type does NOT automatically include null — causing TS2322 when assigning a
  nullable value to a Partial<$inferInsert> update payload.
---

## The rule

After removing `.notNull()` from a Drizzle column, the column accepts null at
runtime (SQL-level), but `typeof table.$inferInsert` keeps the field as
`T | undefined` (optional) rather than `T | null | undefined`.

This produces TS2322 errors when you try to assign a nullable value:
```ts
// ERROR: Type 'null' is not assignable to type '"LINEAIRE" | "DEGRESSIF"'
updatePayload.depreciationType = body.depreciationType; // body value is T | null
```

**Why:** Drizzle infers the insert type from the column builder chain. The
`.$type<T | null>()` override changes the SELECT type but Drizzle's insert-type
inference does not propagate null from `.$type<>()` into `$inferInsert`.

## How to apply

Widen the update payload type explicitly for the nullable columns:
```ts
const updatePayload: Partial<typeof myTable.$inferInsert> & {
  myNullableField?: MyType | null;
  anotherNullableField?: number | null;
} = {};
```

This keeps TypeScript happy while allowing null to flow into the Drizzle
`.update().set()` call (which DOES accept null at runtime for nullable columns).

Also: wherever functions expect the non-null type (e.g. depreciation schedule
engines expecting `DepreciationType`, not `null`), add an explicit null guard
**before** calling those functions — don't rely on the `.$type<>()` override
to make them callable without errors.
