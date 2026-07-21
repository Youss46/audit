---
name: Re-import bootstrap checklist
description: Steps needed when a pnpm_workspace project is re-imported from Vercel — artifacts exist on disk but platform registry is empty.
---

# Re-import bootstrap checklist

When a Replit pnpm_workspace project is exported to Vercel and then re-imported, the artifact platform registry is reset (listArtifacts returns []). The .replit-artifact/artifact.toml files survive on disk but workflows are not created.

## Fix sequence

1. Back up source code: `cp -r artifacts/<slug> /tmp/<slug>-backup`
2. Remove the existing artifact directory: `rm -rf artifacts/<slug>`
3. Call `createArtifact({ artifactType: "react-vite", slug, previewPath, title })` — this registers with the platform and creates the managed workflow.
4. Restore real source code (exclude .replit-artifact and node_modules): `find /tmp/<slug>-backup -not -path './.replit-artifact*' ...`
5. For the api-server (kind="api", no createArtifact type): restore the full directory including its .replit-artifact/, then call `verifyAndReplaceArtifactToml()` — this registers the api artifact and creates its managed workflow.
6. Fix any build path mismatches: the new scaffold writes to `dist/public`; if vite.config.ts was restored from backup using `dist`, update artifact.toml's `publicDir` via `verifyAndReplaceArtifactToml`.
7. Run `pnpm install`, then `pnpm --filter @workspace/db run push`.
8. Seed drizzle migrations tracking table (see below) before starting api-server.
9. Start workflows: `WorkflowsRestart` for each managed workflow.

## Drizzle startup migrator conflict

The api-server runs `migrate()` at startup using SQL files from `dist/drizzle/`. After `drizzle-kit push`, tables already exist — the migrator crashes with "relation X already exists".

**Fix**: Seed `drizzle.__drizzle_migrations` with the SHA256 of the migration SQL:
```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '<sha256>', extract(epoch from now())::bigint * 1000
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '<sha256>');
```

Get the hash: `sha256sum lib/db/drizzle/0000_familiar_whiplash.sql | cut -d' ' -f1`

**Why:** The migrator tracks applied migrations by hash in this table. An empty table makes it think nothing has been applied and tries to re-run everything.
