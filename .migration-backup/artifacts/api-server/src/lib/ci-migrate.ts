/**
 * ci-migrate.ts
 * Migration programmatique pour Railway (sans TTY, sans interaction humaine).
 *
 * Utilise drizzle-orm/migrator : lit les fichiers SQL dans dist/drizzle/,
 * crée la table de tracking si nécessaire, et applique uniquement les
 * migrations non encore enregistrées. Aucune intervention humaine requise.
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist/drizzle/ est copié depuis lib/db/drizzle/ par build.mjs
const migrationsFolder = path.resolve(__dirname, "drizzle");

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
