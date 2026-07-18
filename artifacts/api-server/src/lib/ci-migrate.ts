/**
 * ci-migrate.ts
 * Migration programmatique pour Railway (sans TTY, sans interaction humaine).
 *
 * Stratégie en 3 étapes :
 * 1. Crée la table de tracking Drizzle si elle n'existe pas (premier déploiement).
 * 2. Baseline : si la table est vide, marque la migration 0000 comme déjà appliquée
 *    (le schéma existe déjà en base via drizzle-kit push initial).
 * 3. Applique les migrations suivantes via drizzle-orm/migrator (API programmatique).
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@workspace/db";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chemin vers le dossier drizzle/ de lib/db (embarqué dans le build via esbuild)
const migrationsFolder = path.resolve(__dirname, "../drizzle");

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Étape 1 — table de tracking
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id        SERIAL PRIMARY KEY,
        hash      TEXT NOT NULL,
        created_at BIGINT
      );
    `);

    // Étape 2 — baseline : si vide, marque la migration 0000 comme appliquée
    // sans la rejouer (le schéma a été créé via drizzle-kit push au départ).
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM drizzle.__drizzle_migrations`
    );
    if (rows[0].cnt === 0) {
      // Lit le hash depuis le méta de drizzle-kit pour la migration 0000
      // On insère un timestamp passé pour que toutes les futures migrations passent après.
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         VALUES ('baseline-0000', $1)`,
        [Date.now() - 1000]
      );
    }
  } finally {
    client.release();
  }

  // Étape 3 — applique les nouvelles migrations
  await migrate(db, { migrationsFolder });
}
