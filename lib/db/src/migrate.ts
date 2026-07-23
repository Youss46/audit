/**
 * migrate.ts — runner autonome de migrations Drizzle pour Railway.
 *
 * Doit être exécuté en tant que première étape du releaseCommand, AVANT seed:all,
 * pour garantir que les colonnes et types (ex. enum account_type) existent quand
 * les seeds tentent d'insérer des données.
 *
 * Comportement sur une base existante (pré-Drizzle) :
 *   1. Vérifie si la table `firms` existe déjà.
 *   2. Si oui, marque la migration 0000 comme déjà appliquée (evite de recréer).
 *   3. Applique les migrations suivantes (0001, 0002 …) normalement.
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";
import { sql } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// lib/db/drizzle/ — dossier des fichiers SQL de migration
const migrationsFolder = path.resolve(__dirname, "../drizzle");

const MIGRATION_0000_HASH =
  "f107e607a38332f386706817df820c144fba95ade83a2682d5edfffaa502c47f";

async function dbAlreadyPopulated(): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'firms'
    ) AS exists
  `);
  return result.rows[0]?.exists === true;
}

async function ensureMigration0000Tracked(): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id         serial PRIMARY KEY,
      hash       text NOT NULL,
      created_at bigint
    )
  `);
  await db.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    SELECT ${MIGRATION_0000_HASH},
           ${BigInt(Date.now())}
    WHERE NOT EXISTS (
      SELECT 1 FROM drizzle.__drizzle_migrations
      WHERE hash = ${MIGRATION_0000_HASH}
    )
  `);
}

async function main() {
  console.log("\n🔄 Application des migrations Drizzle…\n");
  const populated = await dbAlreadyPopulated();
  if (populated) {
    // Base existante : marquer 0000 comme déjà appliquée avant de migrer.
    await ensureMigration0000Tracked();
  }
  await migrate(db, { migrationsFolder });
  console.log("✅ Migrations appliquées.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Migration échouée :", err);
  process.exit(1);
});
