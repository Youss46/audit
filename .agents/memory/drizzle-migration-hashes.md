---
name: Drizzle migration hashes
description: SHA256 hashes for all migration SQL files; must be seeded into drizzle.__drizzle_migrations after any db push on a fresh/re-imported environment.
---

# Drizzle migration hashes

After `drizzle-kit push` on a fresh environment, seed these into `drizzle.__drizzle_migrations` so the startup migrator doesn't crash with "relation already exists".

## Hashes (as of the current 4-migration schema)

| File | SHA256 |
|------|--------|
| 0000_familiar_whiplash.sql | f107e607a38332f386706817df820c144fba95ade83a2682d5edfffaa502c47f |
| 0001_add_stations_purchases_momo.sql | 6c4a2225bbc159092b165cb195d30d7ae316c6dac82a270b5dec3db5d7185cbc |
| 0002_add_invoice_amount_paid.sql | 88fb01dab4d86b387203ded3758ef65f336729c31d67be01a1362222bd973d9d |
| 0003_fix_telecom_accounts.sql | 61b66e8ff4cfdb51c370c1897ff87b78c483719b147fd68a09229aba26719c40 |

## Seed SQL template

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '<hash>', extract(epoch from now())::bigint * 1000
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '<hash>');
```

Repeat the INSERT block for each hash. See reimport-bootstrap-checklist.md for the full flow.

**Why:** The api-server runs `migrate()` at startup using SQL from `dist/drizzle/`. After `db push`, tables exist but the tracking table is empty — migrator crashes thinking nothing ran yet.
