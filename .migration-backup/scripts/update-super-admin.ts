/**
 * update-super-admin.ts
 * Met à jour l'email et le mot de passe du super_admin existant.
 * Usage : pnpm --filter @workspace/scripts run update:super-admin
 *
 * Lit les identifiants depuis les variables d'environnement :
 *   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... pnpm --filter @workspace/scripts run update:super-admin
 */

import { db, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;

if (!email || !password) {
  console.error("❌ Définissez SUPER_ADMIN_EMAIL et SUPER_ADMIN_PASSWORD avant de lancer ce script.");
  process.exit(1);
}

async function main() {
  const passwordHash = await bcrypt.hash(password!, 10);
  const result = await db
    .update(usersTable)
    .set({ email, passwordHash })
    .where(eq(usersTable.role, "super_admin"))
    .returning({ id: usersTable.id, email: usersTable.email });

  if (result.length === 0) {
    console.error("❌ Aucun super_admin trouvé. Lancez d'abord seed:super-admin.");
    process.exit(1);
  }

  console.log(`✅ Super admin mis à jour → ${result[0].email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
