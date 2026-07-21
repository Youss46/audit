/**
 * ci-migrate.ts
 * Migration programmatique pour Railway / tout serveur sans TTY.
 *
 * Utilise drizzle-orm/migrator : lit les fichiers SQL dans dist/drizzle/,
 * crée la table de tracking si nécessaire, et applique uniquement les
 * migrations non encore enregistrées. Aucune intervention humaine requise.
 *
 * Comportement sur une base déjà existante (déployée avant Drizzle) :
 *   1. Vérifie si la table `firms` existe déjà (base non vierge).
 *   2. Si oui et si la migration 0000 n'est pas encore trackée, l'enregistre
 *      comme déjà appliquée — évite de re-créer des tables existantes.
 *   3. Exécute normalement les migrations suivantes (0001, 0002 …).
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist/drizzle/ est copié depuis lib/db/drizzle/ par build.mjs
const migrationsFolder = path.resolve(__dirname, "drizzle");

const MIGRATION_0000_HASH =
  "f107e607a38332f386706817df820c144fba95ade83a2682d5edfffaa502c47f";

/**
 * Retourne true si la table `firms` existe déjà dans le schéma public.
 * Utilisé pour détecter une base pré-Drizzle.
 */
async function dbAlreadyPopulated(): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'firms'
    ) AS exists
  `);
  return result.rows[0]?.exists === true;
}

/**
 * Crée le schéma + table de tracking Drizzle si absents, puis insère
 * le hash de la migration 0000 s'il n'est pas encore enregistré.
 */
async function seedMigration0000(): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id        serial PRIMARY KEY,
      hash      text NOT NULL,
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

export async function runMigrations(): Promise<void> {
  const populated = await dbAlreadyPopulated();
  if (populated) {
    // Base existante : marquer 0000 comme déjà appliquée avant de migrer.
    await seedMigration0000();
  }
  await migrate(db, { migrationsFolder });
}
